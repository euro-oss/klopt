import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** The class merger shadcn/ui components expect. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
