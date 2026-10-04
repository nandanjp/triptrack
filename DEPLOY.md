# Deploy

Push to `main`. CI builds an immutable `sha-` tagged image, pins that tag into
`charts/triptrack/values.yaml`, and Argo CD syncs the resulting commit. Nothing is
deployed by hand.

```bash
curl -s https://triptrack.nandan-hl.dev/health
# {"status":"ok","version":"sha-a1b2c3d"}
```

## Bootstrap — once, by hand

**Status: not yet executed.** Every step below is the intended procedure, not a record of
one that ran. Each needs its real output pasted in as it is performed, including failures.

The machine this was written on has **no kubeconfig at all** — no `~/.kube/config` and no
`KUBECONFIG`, so `kubectl` falls back to `localhost:8080` and fails with a connection
refused that looks like a down cluster but is not. Fetch the k3s kubeconfig from
`homelab` before starting:

```sh
mkdir -p ~/.kube
ssh homelab "sudo cat /etc/rancher/k3s/k3s.yaml" \
  | sed "s/127.0.0.1/<homelab-address>/" > ~/.kube/config
chmod 600 ~/.kube/config
kubectl get nodes
```

Order matters: CI must pin a real image tag **before** the Argo CD Application is
applied, or the first sync pulls `sha-0000000` and sits in `ImagePullBackOff`.

### 1. Docker Hub credential for CI

The workflow pushes as `nandanjp` using a `DOCKERHUB_TOKEN` repository secret.

```sh
gh secret set DOCKERHUB_TOKEN --repo nandanjp/triptrack
```

### 2. Let CI build and pin the first image

Merging step 1 triggers `.github/workflows/docker.yml`, which builds
`nandanjp/triptrack:sha-<short>` and commits that tag into the chart. Confirm the pin
landed before continuing:

```sh
git pull && grep '  tag:' charts/triptrack/values.yaml
```

### 3. Deploy key — required, because this repo is private

Argo CD cannot read a private repository without one. Use a **read-only deploy key**
scoped to this repo, not a personal access token.

```sh
ssh-keygen -t ed25519 -C "argocd@triptrack" -f ./argocd-triptrack -N ""
gh repo deploy-key add ./argocd-triptrack.pub --repo nandanjp/triptrack --title "argocd"

kubectl -n argocd create secret generic triptrack-repo \
  --from-literal=type=git \
  --from-literal=url=git@github.com:nandanjp/triptrack.git \
  --from-file=sshPrivateKey=./argocd-triptrack
kubectl -n argocd label secret triptrack-repo \
  argocd.argoproj.io/secret-type=repository

rm -f ./argocd-triptrack ./argocd-triptrack.pub
```

### 3b. Create the application secret

Three keys, created out of band and never committed. Note that the password appears
twice — once alone for Postgres's own `POSTGRES_PASSWORD`, and once inside the
connection string the application reads. That duplication is deliberate: composing the
URL in the chart would mean interpolating a secret value into an env var, which
Kubernetes cannot do.

```sh
PG_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=' | head -c 40)"
SESSION_SECRET="$(openssl rand -base64 48)"

kubectl create namespace triptrack --dry-run=client -o yaml | kubectl apply -f -

kubectl -n triptrack create secret generic triptrack \
  --from-literal=postgres-password="$PG_PASSWORD" \
  --from-literal=session-secret="$SESSION_SECRET" \
  --from-literal=database-url="postgres://triptrack:${PG_PASSWORD}@triptrack-postgres:5432/triptrack"
```

To add or change one key later, use `patch` — `create` fails if the secret exists, and
`create --dry-run | apply` silently drops every other key:

```sh
kubectl -n triptrack patch secret triptrack -p '{"stringData":{"session-secret":"..."}}'
kubectl -n triptrack rollout restart deploy/triptrack
```

The restart is required, not optional: **env-injected secrets are read once at process
start.** Rotating `session-secret` also signs every user out (ADR-0005).

### 4. Register the application

Argo CD is **shared and installed by `../dramadive`**. This repo contributes exactly one
cluster object. Never apply an `argocd-cm` or `argocd-cmd-params-cm` from here — that
drops `helm.valuesFileSchemes` and silently breaks the other applications on the
cluster.

```sh
kubectl apply -f argocd/application.yaml
kubectl -n argocd get application triptrack
```

`CreateNamespace=true` is set, so the `triptrack` namespace is created by the sync.

### 5. Webhook, so a push syncs immediately

Without it, Argo CD waits for its poll interval.

```sh
gh api repos/nandanjp/triptrack/hooks -X POST \
  -f name=web -F active=true -f events[]=push \
  -f config[url]=https://argocd.nandan-hl.dev/api/webhook \
  -f config[content_type]=json \
  -f config[secret]="$(kubectl -n argocd get secret argocd-secret \
      -o jsonpath='{.data.webhook\.github\.secret}' | base64 -d)"
```

`argocd-secret` is **shared across every repository** pointed at this Argo CD. Read the
existing value, as above; do not overwrite it.

## Verify the pipeline

Step 1 is not done until an empty commit changes the reported version with no manual
intervention:

```sh
git commit --allow-empty -m "test: prove the pipeline deploys" && git push
# wait for the workflow, then:
curl -s https://triptrack.nandan-hl.dev/health
```

The `version` must differ from before. A green check is not evidence; this is.

## Rollback

The chart's image tag is the deploy history, so a rollback is a git revert of the pin
commit:

```sh
git log --oneline -- charts/triptrack/values.yaml
git revert <pin-commit> && git push
```

Argo CD syncs the revert and rolls the previous image back in behind its probes.
`revisionHistoryLimit: 5` also allows `kubectl -n triptrack rollout undo deploy/triptrack`
as an emergency escape hatch, but that leaves git out of sync and Argo CD will
self-heal it away — prefer the revert.
