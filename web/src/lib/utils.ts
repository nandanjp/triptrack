import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Joins class names and lets a later conflicting utility win, so a component's
 * own classes can be overridden from a call site without specificity games.
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
