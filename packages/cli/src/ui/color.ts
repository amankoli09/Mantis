import pc from 'picocolors';

export interface Colors {
  green(text: string): string;
  red(text: string): string;
  yellow(text: string): string;
  cyan(text: string): string;
  dim(text: string): string;
  bold(text: string): string;
  white(text: string): string;
  magenta(text: string): string;
}

const noColors: Colors = {
  green: (s) => s,
  red: (s) => s,
  yellow: (s) => s,
  cyan: (s) => s,
  dim: (s) => s,
  bold: (s) => s,
  white: (s) => s,
  magenta: (s) => s,
};

let forceNoColor = false;

export function setNoColor(disabled: boolean): void {
  forceNoColor = disabled;
}

export function isColorEnabled(): boolean {
  const isTty = process.stdout.isTTY ?? false;
  const noColorEnv = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '';
  if (forceNoColor || noColorEnv || !isTty) {
    return false;
  }
  return true;
}

export function getColors(): Colors {
  if (!isColorEnabled()) {
    return noColors;
  }

  return {
    green: pc.green,
    red: pc.red,
    yellow: pc.yellow,
    cyan: pc.cyan,
    dim: pc.dim,
    bold: pc.bold,
    white: pc.white,
    magenta: pc.magenta,
  };
}
