import type { RaspberryCodeConfigOption } from "@raspberrycode/shared";

function areJsonEquivalent(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function areConfigOptionsEquivalent(
  left: readonly RaspberryCodeConfigOption[] | null | undefined,
  right: readonly RaspberryCodeConfigOption[] | null | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  return left.every((option, index) => {
    const rightOption = right[index];
    return Boolean(rightOption) && areJsonEquivalent(option, rightOption);
  });
}
