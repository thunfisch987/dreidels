import { WriteStream } from "tty";

export type Color =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "gray"
  | "redBright"
  | "greenBright"
  | "yellowBright"
  | "blueBright"
  | "magentaBright"
  | "cyanBright"
  | "whiteBright"
  | false;

export type SpinnerPrefix = false | string;

export interface SpinnerAnimation {
  interval: number;
  frames: string[];
}

export type SpinnerAnimationOption = string | SpinnerAnimation;

export interface SpinnerOptions {
  status: string;
  text: string;
  indent: number;
  hidden: boolean;
}

export interface ColorOptions {
  color?: Color;
  succeedColor?: Color;
  failColor?: Color;
  warnColor?: Color;
  infoColor?: Color;
  spinnerColor?: Color;
}

export interface SpinnerPrefixOptions {
  succeedPrefix?: SpinnerPrefix;
  failPrefix?: SpinnerPrefix;
  warnPrefix?: SpinnerPrefix;
  infoPrefix?: SpinnerPrefix;
}

export interface SpinnerStatus {
  prefix: SpinnerPrefix;
  prefixColor: Color;
  spinnerColor: Color;
  textColor: Color;
  isStatic: boolean;
  noSpaceAfterPrefix: boolean;
  isDone: boolean;
}

export type SpinniesOptions = SpinnerPrefixOptions &
  ColorOptions & {
    stream: WriteStream;
    disableSpins?: boolean;
    spinner: SpinnerAnimation;
  };

export interface UpdateSpinnerOptions extends Partial<SpinnerOptions> {
  color?: Color;
  succeedColor?: Color;
  failColor?: Color;
}
