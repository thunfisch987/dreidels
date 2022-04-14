import readline from "readline";
import stripAnsi from "strip-ansi";
import wordwrapjs from "wordwrapjs";
const EOL = require("os").EOL;
import { dashes, dots } from "./spinners.json";
import { purgeOptions, some, equal, type, oneOf } from "./purgeOptions";
import {
  ColorOptions,
  SpinnerAnimation,
  SpinnerAnimationOption,
  SpinnerOptions,
  SpinnerPrefixOptions,
  SpinnerStatus,
  SpinniesOptions,
} from "./types";
import { Writable } from "stream";
import { WriteStream } from "tty";

let symbols: {
  succeedPrefix: string;
  failPrefix: string;
  warnPrefix: string;
  infoPrefix: string;
};
if (terminalSupportsUnicode()) {
  symbols = {
    succeedPrefix: "✓",
    failPrefix: "✖",
    warnPrefix: "⚠",
    infoPrefix: "ℹ",
  };
} else {
  symbols = {
    succeedPrefix: "√",
    failPrefix: "×",
    warnPrefix: "!!",
    infoPrefix: "i",
  };
}

export const VALID_COLORS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "gray",
  "redBright",
  "greenBright",
  "yellowBright",
  "blueBright",
  "magentaBright",
  "cyanBright",
  "whiteBright",
  false,
];

export const isValidPrefix = some([
  equal(false),
  type("string"),
  type("number"),
]);
export const isValidColor = oneOf(VALID_COLORS);

export function purgeSpinnerOptions(
  options: Partial<SpinnerOptions & ColorOptions>
) {
  const purged = purgeOptions(
    {
      status: type("string"),
      text: type("string"),
      indent: type("number"),
      hidden: type("boolean"),
    },
    options
  );
  const colors = colorOptions(options);

  return { ...colors, ...purged };
}

export function purgeSpinnersOptions({
  spinner,
  disableSpins,
  stream,
  ...others
}: Partial<SpinniesOptions>) {
  const colors = colorOptions(others);
  const prefixes = prefixOptions(others);
  const disableSpinsOption =
    typeof disableSpins === "boolean" ? { disableSpins } : {};
  const streamOption = stream ? { stream } : {};
  spinner = turnToValidSpinner(spinner);

  return {
    ...colors,
    ...prefixes,
    ...disableSpinsOption,
    ...streamOption,
    spinner,
  };
}

export function purgeStatusOptions(options: Partial<SpinnerStatus>) {
  return purgeOptions(
    {
      prefix: isValidPrefix,
      prefixColor: isValidColor,
      spinnerColor: isValidColor,
      textColor: isValidColor,
      isStatic: type("boolean"),
      noSpaceAfterPrefix: type("boolean"),
      isDone: type("boolean"),
    },
    options
  );
}

export function turnToValidSpinner(spinner: any = {}): SpinnerAnimation {
  const platformSpinner = terminalSupportsUnicode() ? dots : dashes;

  if (typeof spinner === "string") {
    try {
      const cliSpinners = require("cli-spinners");
      const selectedSpinner = cliSpinners[spinner];

      if (selectedSpinner) {
        return selectedSpinner;
      }

      return platformSpinner; // The spinner doesn't exist in the cli-spinners library
    } catch {
      // cli-spinners is not installed, ignore :
      return platformSpinner;
    }
  }

  if (typeof spinner !== "object") return platformSpinner;
  let { interval, frames } = spinner;
  if (!Array.isArray(frames) || frames.length < 1)
    frames = platformSpinner.frames;
  if (typeof interval !== "number") interval = platformSpinner.interval;

  return { interval, frames };
}

export function colorOptions(options: ColorOptions) {
  return purgeOptions(
    {
      color: isValidColor,
      succeedColor: isValidColor,
      failColor: isValidColor,
      warnColor: isValidColor,
      infoColor: isValidColor,
      spinnerColor: isValidColor,
    },
    options
  );
}

export function prefixOptions(prefixes: SpinnerPrefixOptions) {
  const purgedPrefixes = purgeOptions(
    {
      succeedPrefix: isValidPrefix,
      failPrefix: isValidPrefix,
      warnPrefix: isValidPrefix,
      infoPrefix: isValidPrefix,
    },
    prefixes
  );

  return { ...symbols, ...purgedPrefixes };
}

export function breakText(
  text: string,
  prefixLength: number,
  indent = 0,
  stream: WriteStream
) {
  const columns = stream.columns || 95;

  return wordwrapjs.wrap(text, {
    break: true,
    width: columns - prefixLength - indent - 1,
  });
}

export function indentText(text: string, prefixLength: number, indent = 0) {
  if (!prefixLength && !indent) return text;

  const repeater = (index: number) =>
    " ".repeat(index !== 0 ? prefixLength + indent : 0);

  return text
    .split(/\r\n|\r|\n/)
    .map((line, index) => `${repeater(index)}${line}`)
    .join(EOL);
}

export function secondStageIndent(str: string, indent = 0) {
  return `${" ".repeat(indent)}${str}`; // Indent the prefix after it was added
}

export function getLinesLength(text: string) {
  return stripAnsi(text)
    .split(/\r\n|\r|\n/)
    .map((line) => line.length);
}

export function writeStream(
  stream: WriteStream,
  output: string,
  rawLines: number[]
) {
  stream.write(output);
  readline.moveCursor(stream, 0, -rawLines.length);
}

export function cleanStream(stream: WriteStream, rawLines: number[]) {
  rawLines.forEach((lineLength, index) => {
    readline.moveCursor(stream, lineLength, index);
    readline.clearLine(stream, 1);
    readline.moveCursor(stream, -lineLength, -index);
  });
  readline.moveCursor(stream, 0, rawLines.length);
  readline.clearScreenDown(stream);
  readline.moveCursor(stream, 0, -rawLines.length);
}

export function terminalSupportsUnicode() {
  // The default command prompt and powershell in Windows do not support Unicode characters.
  // However, the VSCode integrated terminal and the Windows Terminal both do.
  return (
    process.platform !== "win32" ||
    process.env.TERM_PROGRAM === "vscode" ||
    !!process.env.WT_SESSION
  );
}

export function isError(err: any) {
  return err && err.message && err.stack;
}

export const isCI = // Taken from ci-info [https://github.com/watson/ci-info]
  process.env.CI || // Travis CI, CircleCI, Cirrus CI, Gitlab CI, Appveyor, CodeShip, dsari
  process.env.CONTINUOUS_INTEGRATION || // Travis CI, Cirrus CI
  process.env.BUILD_NUMBER || // Jenkins, TeamCity
  process.env.RUN_ID || // TaskCluster, dsari
  false;
