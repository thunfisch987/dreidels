export type Rule = (value: any) => boolean;

export function purgeOptions<_, A extends Record<string, any>>(
  rules: Record<string, Rule>,
  options: A
): Partial<A> {
  return Object.keys(options)
    .filter((key) => {
      const rule = rules[key];

      if (!rule) return false;

      return rule(options[key]);
    })
    .reduce((obj, key) => {
      return {
        ...obj,
        [key]: options[key],
      };
    }, {});
}

export function type(type: string) {
  return (value: any) => typeof value === type;
}

export function oneOf(arr: any[]) {
  return (value: any) => arr.includes(value);
}

export function equal(what: any) {
  return (value: any) => value === what;
}

export function all(requirements: Rule[]) {
  return (value: any) => {
    for (const req of requirements) {
      if (!req(value)) {
        return false;
      }
    }

    return true;
  };
}

export function some(requirements: Rule[]) {
  return (value: any) => requirements.some((req) => req(value));
}

export function isArray() {
  return (value: any) => Array.isArray(value);
}
