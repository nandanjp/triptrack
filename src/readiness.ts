let ready = true;

/** Whether this pod should receive traffic. Reflects only this process. */
export const isReady = (): boolean => ready;

export const beginDraining = (): void => {
  ready = false;
};

/** Test-only: readiness is module state, so it needs resetting between cases. */
export const resetReadiness = (): void => {
  ready = true;
};
