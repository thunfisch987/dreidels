"use strict";
import readline from "readline";
import colorette from "colorette";
import cliCursor from "cli-cursor";
import onExit from "signal-exit";
const EventEmitter = require("events").EventEmitter;
const EOL = require("os").EOL;
import isPromise from "is-promise";
import isObservable from "is-observable";
import { dashes, dots } from "./spinners.json";
import {
  writeStream,
  cleanStream,
  secondStageIndent,
  indentText,
  turnToValidSpinner,
  purgeSpinnerOptions,
  purgeSpinnersOptions,
  purgeStatusOptions,
  colorOptions,
  breakText,
  getLinesLength,
  terminalSupportsUnicode,
  isCI,
  isError,
  isValidPrefix,
  isValidColor,
} from "./utils";
import {
  ColorOptions,
  SpinnerAnimationOption,
  SpinnerOptions,
  SpinnerPrefixOptions,
  SpinnerStatus,
  SpinniesOptions,
  UpdateSpinnerOptions,
} from "./types";
import { WriteStream } from "tty";

export { dashes, dots } from "./spinners.json";

const DEFAULT_STATUS = "spinning";

export class StatusRegistry extends EventEmitter {
  defaultStatus: string;
  statuses: Record<string, SpinnerStatus>;

  constructor(defaultStatus: string) {
    super();

    this.defaultStatus = defaultStatus;
    this.statuses = {};
    this.statusesAliases = {};
  }

  configureStatus(
    name: string,
    statusOptions: Partial<SpinnerStatus> & { aliases?: string[] | string } = {}
  ) {
    if (!name) throw new Error("Status name must be a string");
    let { aliases } = statusOptions;
    const existingStatus: Partial<SpinnerStatus> = this.statuses[name] || {};
    const purgedOptions = purgeStatusOptions(statusOptions);

    // @ts-expect-error
    const opts: SpinnerStatus = {
      prefix: false,
      isStatic: false,
      noSpaceAfterPrefix: false,
      spinnerColor: "cyan",
      prefixColor: "cyan",
      textColor: false,
      ...existingStatus,
      ...purgedOptions,
    };

    if (opts.isDone === undefined) {
      opts.isDone = opts.isStatic;
    }

    if (this.statuses[name] === undefined) {
      this.emit("statusAdded", name);
    }
    this.statuses[name] = opts;

    if (aliases) {
      aliases = Array.isArray(aliases) ? aliases : [aliases];
      aliases.forEach((aliasName) => {
        if (typeof aliasName !== "string") return;

        if (this.statusesAliases[aliasName] === undefined) {
          this.emit("statusAdded", aliasName);
        }
        this.statusesAliases[aliasName] = name;
      });
    }

    return this;
  }

  getStatus(name: string) {
    const status = this.statuses[name];
    if (status) {
      return status;
    }

    const fromAlias = this.statusesAliases[name];
    if (fromAlias && this.statuses[fromAlias]) {
      return this.statuses[fromAlias];
    }

    return this.statuses[this.defaultStatus];
  }

  actualName(nameOrAlias: string) {
    if (this.statuses[nameOrAlias]) return nameOrAlias;
    return this.statusesAliases[nameOrAlias];
  }
}

class Spinnie extends EventEmitter {
  logs: string[];
  options: SpinnerOptions & ColorOptions & SpinnerPrefixOptions;
  statusRegistry: StatusRegistry;
  statusOverrides: Record<string, Partial<SpinnerStatus>>;
  stream: WriteStream;

  constructor({
    name,
    options,
    inheritedOptions,
    statusRegistry,
    logs,
    stream,
  }: {
    name: string;
    statusRegistry: StatusRegistry;
    stream: WriteStream;
    options: Partial<SpinnerOptions>;
    inheritedOptions: SpinniesOptions;
    logs: string[];
  }) {
    super();

    const text = options.text !== undefined ? options.text : name;
    if (!options.text) options.text = name;
    const spinnerProperties: SpinnerOptions &
      ColorOptions &
      SpinnerPrefixOptions = {
      ...colorOptions(inheritedOptions),
      succeedPrefix: inheritedOptions.succeedPrefix,
      failPrefix: inheritedOptions.failPrefix,
      status: "spinning",
      hidden: false,
      indent: 0,
      text,
      ...purgeSpinnerOptions(options),
    };

    this.logs = logs;
    this.options = spinnerProperties;
    this.statusRegistry = statusRegistry;
    this.statusOverrides = {};
    this.stream = stream;

    Object.keys(this.statusRegistry.statuses).forEach((name) => {
      this.aliasStatusAsMethod(name);
    });

    Object.keys(this.statusRegistry.statusesAliases).forEach((name) => {
      this.aliasStatusAsMethod(name);
    });

    this.applyStatusOverrides(spinnerProperties);

    return this;
  }

  update(options: UpdateSpinnerOptions = {}) {
    const { status } = options;
    const keys = Object.keys(options);
    if (keys.length === 1 && keys[0] === "status")
      return this.status(status as string); // skip all options purging...

    this.setSpinnerProperties(options, status);
    this.updateSpinnerState();

    return this;
  }

  status(statusName: string) {
    if (!statusName || typeof statusName !== "string") return this;
    this.options.status = statusName;
    this.updateSpinnerState();

    return this;
  }

  text(newText: string) {
    if (typeof newText !== "string") return this;
    this.options.text = newText;
    this.updateSpinnerState();

    return this;
  }

  indent(newIndent: number) {
    if (typeof newIndent !== "number") return this;
    this.options.indent = newIndent;
    this.updateSpinnerState();

    return this;
  }

  remove() {
    this.emit("removeMe");
  }

  hidden(bool?: boolean) {
    if (typeof bool === "boolean" && this.options.hidden !== bool) {
      this.options.hidden = bool;
      this.updateSpinnerState();
    }
    return this.options.hidden;
  }

  hide() {
    return this.hidden(true);
  }

  show() {
    return this.hidden(false);
  }

  bind(task: any) {
    if (isObservable(task)) {
      task = new Promise((resolve, reject) => {
        task.subscribe({
          next: (text: string) => {
            if (typeof text !== "string") return;
            this.text(text);
          },
          error: reject,
          complete: resolve,
        });
      });
    }

    if (isPromise(task)) {
      task
        .then((result: string) => {
          if (result && typeof result === "string") {
            this.update({ status: "success", text: result });
          } else {
            this.status("success");
          }
        })
        .catch((err: any) => {
          let message: boolean | string = false;

          if (typeof err === "string") {
            message = err;
          } else if (isError(err)) {
            const color = this.getStatus("fail").textColor;
            const msg = err.message;
            const stack = err.stack.substring(err.stack.indexOf("\n") + 1);

            this.statusOverrides.fail.textColor = false; // to prevent spinnies from painting the text
            // @ts-expect-error
            message = `${colorette[color](msg)}\n${colorette.gray(stack)}`;
          }

          if (message !== false) {
            this.update({ status: "fail", text: message });
          } else {
            this.status("fail");
          }
        });
    }
  }

  applyStatusOverrides(opts: any) {
    const newOpts = {
      ...opts,
      successColor: opts.succeedColor,
      successPrefix: opts.succeedPrefix,
      spinningColor: opts.color,
    };
    const statuses = ["success", "fail", "warn", "info", "spinning"];

    statuses.forEach((status) => {
      const overrides: Partial<SpinnerStatus> = {};
      const prefix = newOpts[status + "Prefix"];
      const color = newOpts[status + "Color"];

      // Validate options
      if (isValidPrefix(prefix)) {
        overrides.prefix = prefix;
      }
      if (isValidColor(color)) {
        overrides.prefixColor = color;
        overrides.textColor = color;
      }

      // Spinner color exception
      if (status === "spinning" && isValidColor(opts.spinnerColor)) {
        overrides.spinnerColor = opts.spinnerColor;
        overrides.prefixColor = opts.spinnerColor;
      }

      // Apply overrides
      const current = this.statusOverrides[status] || {};
      this.statusOverrides[status] = { ...current, ...overrides };
    });
  }

  isActive() {
    return !this.getStatus(this.options.status).isDone;
  }

  rawRender() {
    const status = this.getStatus(this.options.status);
    const text = this.options.text;
    const renderedPrefix = `${
      status.prefix
        ? (status.prefixColor
            ? colorette[status.prefixColor](status.prefix)
            : status.prefix) + (status.noSpaceAfterPrefix ? "" : " ")
        : ""
    }`;
    let output = `${renderedPrefix}${
      status.textColor ? colorette[status.textColor](text) : text
    }`;

    const indent = this.options.indent;
    let prefixLengthToIndent = 0;
    if (status.prefix) {
      // only if we have a prefix...
      prefixLengthToIndent = status.prefix.length;
      if (!status.noSpaceAfterPrefix) {
        // if we have a space after the prefix add 1 to the prefix length
        prefixLengthToIndent += 1;
      }
    }

    output = breakText(output, 0, indent, this.stream);
    output = indentText(output, prefixLengthToIndent, indent);
    output = secondStageIndent(output, indent);

    return output;
  }

  render(frame: string) {
    let { text, status, indent } = this.options;
    const statusOptions = this.getStatus(status);
    let line;
    let prefix = "";

    if (!statusOptions.isStatic) {
      prefix = frame;
      if (!statusOptions.noSpaceAfterPrefix) {
        prefix += " ";
      }
    } else if (statusOptions.prefix) {
      prefix = statusOptions.prefix;
      if (!statusOptions.noSpaceAfterPrefix) {
        prefix += " ";
      }
    }
    const prefixLength = prefix.length;
    const textColor = statusOptions.textColor;
    const prefixColor = statusOptions.isStatic
      ? statusOptions.prefixColor
      : statusOptions.spinnerColor;

    text = breakText(text as string, prefixLength, indent, this.stream);
    text = indentText(text as string, prefixLength, indent);
    line = `${
      prefixLength
        ? prefixColor
          ? colorette[prefixColor](prefix)
          : prefix
        : ""
    }${textColor ? colorette[textColor](text) : text}`;
    line = secondStageIndent(line, indent);

    return line;
  }

  addLog(log: string) {
    this.logs.push(log);
  }

  getStatus(name: string) {
    const override =
      this.statusOverrides[this.statusRegistry.actualName(name)] || {};
    return { ...this.statusRegistry.getStatus(name), ...override };
  }

  setSpinnerProperties(options: UpdateSpinnerOptions, status?: string) {
    this.applyStatusOverrides(options);
    options = purgeSpinnerOptions(options);
    status = status || this.options.status || "spinning";

    this.options = { ...this.options, ...options, status };
    return this;
  }

  aliasStatusAsMethod(name: string) {
    if (this[name] !== undefined) return;

    this[name] = (options: UpdateSpinnerOptions) =>
      this.update({ ...options, status: name });
  }

  updateSpinnerState() {
    this.emit("updateSpinnerState");
  }
}

export default class Spinnies {
  options: SpinniesOptions;
  logs: string[] = [];
  spinners: Record<string, Spinnie> = {};
  statusRegistry: StatusRegistry = new StatusRegistry(DEFAULT_STATUS);

  isCursorHidden: boolean = false;
  currentInterval?: ReturnType<typeof setInterval> = undefined;
  lineCount = 0;
  currentFrameIndex = 0;
  stream: WriteStream;
  spin: boolean;

  // @ts-expect-error I dont know why we dynamically set this method
  // But we just do.
  removeExitListener: () => void;

  // This is for new statuses and stuff
  [v: string]: any;

  constructor(options: Partial<SpinniesOptions> = {}) {
    options = purgeSpinnersOptions(options);
    this.options = {
      color: "white",
      spinnerColor: "greenBright",
      succeedColor: "green",
      failColor: "red",
      warnColor: "yellow",
      infoColor: "blue",
      spinner: terminalSupportsUnicode() ? dots : dashes,
      disableSpins: false,
      stream: process.stderr,
      ...options,
    };

    this.logs = [];
    this.spinners = {};
    this.statusRegistry = new StatusRegistry(DEFAULT_STATUS);

    this.isCursorHidden = false;
    this.stream = this.options.stream;
    this.lineCount = 0;
    this.currentFrameIndex = 0;
    this.spin =
      !this.options.disableSpins && !isCI && this.stream && this.stream.isTTY;

    this.statusRegistry.on("statusAdded", (name: string) => {
      Object.values(this.spinners).forEach((spinner) => {
        spinner.aliasStatusAsMethod(name);
      });
      this.aliasChildMethod(name);
    });

    this.statusRegistry.configureStatus("spinning", {
      aliases: ["spin", "active", "default"],
      spinnerColor: this.options.color,
      textColor: this.options.color,
      prefix: "-",
      prefixColor: this.options.color,
    });
    this.statusRegistry.configureStatus("success", {
      aliases: ["succeed", "done"],
      prefix: this.options.succeedPrefix,
      isStatic: true,
      noSpaceAfterPrefix: false,
      prefixColor: this.options.succeedColor,
      textColor: this.options.succeedColor,
    });
    this.statusRegistry.configureStatus("fail", {
      aliases: ["failed", "error"],
      prefix: this.options.failPrefix,
      isStatic: true,
      noSpaceAfterPrefix: false,
      prefixColor: this.options.failColor,
      textColor: this.options.failColor,
    });
    this.statusRegistry.configureStatus("warn", {
      aliases: "warning",
      prefix: this.options.warnPrefix,
      isStatic: true,
      noSpaceAfterPrefix: false,
      prefixColor: this.options.warnColor,
      textColor: this.options.warnColor,
    });
    this.statusRegistry.configureStatus("info", {
      aliases: "information",
      prefix: this.options.infoPrefix,
      isStatic: true,
      noSpaceAfterPrefix: false,
      prefixColor: this.options.infoColor,
      textColor: this.options.infoColor,
    });
    this.statusRegistry.configureStatus("non-spinnable", {
      aliases: ["static", "inactive"],
      prefix: false,
      isStatic: true,
    });
    this.statusRegistry.configureStatus("stopped", {
      aliases: ["stop", "cancel"],
      prefix: false,
      isStatic: true,
      textColor: "gray",
    });

    [
      "update",
      "status",
      "setSpinnerProperties",
      "hidden",
      "hide",
      "show",
      "text",
      "indent",
      "bind",
    ].forEach((method) => {
      this.aliasChildMethod(method);
    });

    this.bindExitEvent();
  }

  addLog(str: string) {
    this.logs.push(str);
  }

  get(name: string) {
    if (typeof name !== "string")
      throw new Error("A spinner reference name must be specified");
    if (!this.spinners[name])
      throw new Error(`No spinner initialized with name ${name}`);
    return this.spinners[name];
  }

  pick(name: string) {
    return this.get(name).options;
  }

  setFrames(frames: SpinnerAnimationOption) {
    const spinner = turnToValidSpinner(frames);
    this.options.spinner = spinner;
    this.currentFrameIndex = 0;
    this.updateSpinnerState();

    return this;
  }

  add(name: string, options: UpdateSpinnerOptions = {}) {
    if (typeof name !== "string")
      throw new Error("A spinner reference name must be specified");
    if (this.spinners[name] !== undefined)
      throw new Error(`A spinner named '${name}' already exists`);

    const spinnie = new Spinnie({
      name,
      options,
      stream: this.stream,
      inheritedOptions: this.options,
      statusRegistry: this.statusRegistry,
      logs: this.logs,
    });

    spinnie
      .on("removeMe", () => {
        this.remove(name);
      })
      .on("updateSpinnerState", () => {
        this.updateSpinnerState(name);
      });

    this.spinners[name] = spinnie;

    this.updateSpinnerState(name);

    return spinnie;
  }

  remove(name: string) {
    if (typeof name !== "string")
      throw new Error("A spinner reference name must be specified");
    if (!this.get(name))
      throw new Error(`No spinner initialized with name ${name}`);

    this.get(name).removeAllListeners();
    delete this.spinners[name];
    this.updateSpinnerState();
  }

  stopAll(newStatus = "stopped") {
    if (this.statusRegistry.actualName(newStatus) === undefined)
      newStatus = "stopped";
    Object.keys(this.spinners).forEach((name) => {
      const currentSpinner = this.get(name);
      const currentStatus = currentSpinner.getStatus(
        currentSpinner.options.status
      );
      if (!currentStatus.isDone) {
        currentSpinner.options.status = newStatus;
      }
    });
    this.checkIfActiveSpinners();

    return this.spinners;
  }

  hasActiveSpinners() {
    return !!Object.values(this.spinners).find((spinner) => spinner.isActive());
  }

  updateSpinnerState(name?: string) {
    if (this.spin) {
      clearInterval(this.currentInterval as NodeJS.Timer);
      this.currentInterval = this.loopStream();
      if (!this.isCursorHidden) cliCursor.hide();
      this.isCursorHidden = true;
      this.checkIfActiveSpinners();
    } else {
      if (!name) return;
      const spinner = this.get(name);

      if (spinner.hidden()) return;
      this.stream.write(spinner.rawRender() + EOL);
    }
  }

  loopStream() {
    const { frames, interval } = this.options.spinner;
    return setInterval(() => {
      this.setStreamOutput(frames[this.currentFrameIndex]);
      this.currentFrameIndex =
        this.currentFrameIndex === frames.length - 1
          ? 0
          : ++this.currentFrameIndex;
    }, interval);
  }

  setStreamOutput(frame = "") {
    let output = "";
    const linesLength: number[] = [];
    const hasActiveSpinners = this.hasActiveSpinners();
    Object.values(this.spinners)
      .filter((spinner) => !spinner.hidden())
      .forEach((spinner) => {
        const lines = spinner.render(frame);
        const length = getLinesLength(lines);

        linesLength.push(...length);
        output += lines + EOL;
      });

    if (!hasActiveSpinners) readline.clearScreenDown(this.stream);
    writeStream(this.stream, output, linesLength);
    if (hasActiveSpinners) cleanStream(this.stream, linesLength);
    this.lineCount = linesLength.length;
  }

  checkIfActiveSpinners() {
    if (!this.hasActiveSpinners()) {
      if (this.spin) {
        this.setStreamOutput();
        readline.moveCursor(this.stream, 0, this.lineCount);
        clearInterval(this.currentInterval as NodeJS.Timer);
        this.isCursorHidden = false;
        cliCursor.show();
      }
      this.spinners = {};
      this.removeExitListener();
    }
  }

  aliasChildMethod(method: string) {
    if (this[method] !== undefined) return;

    this[method] = (name: string, ...args: any[]) => {
      const spinner = this.get(name);
      return spinner[method](...args);
    };
  }

  bindExitEvent() {
    this.removeExitListener = onExit(
      () => {
        // cli-cursor will automatically show the cursor...
        readline.moveCursor(this.stream, 0, this.lineCount);
      },
      { alwaysLast: true }
    );
  }

  log(method = console.log) {
    this.logs.forEach((log) => method(log));
  }

  getLogs() {
    return this.logs;
  }
}
