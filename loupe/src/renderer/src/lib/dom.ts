/** True when an event target is an element inside `selector`. Window/document targets (synthetic events) are never inside. */
export function targetIn(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && !!target.closest(selector)
}
