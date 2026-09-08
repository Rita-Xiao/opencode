import { expect, test } from "bun:test"
import type { Page } from "@playwright/test"
import { measureNavigationMilestones, summarizeNavigationMilestones } from "../timeline/navigation-milestones"

test("reports first and stable paint for each navigation milestone", () => {
  expect(
    summarizeNavigationMilestones([
      { observedAtMs: 16, milestones: { content: false, tab: false } },
      { observedAtMs: 32, milestones: { content: true, tab: false } },
      { observedAtMs: 48, milestones: { content: true, tab: true } },
      { observedAtMs: 64, milestones: { content: true, tab: true } },
      { observedAtMs: 80, milestones: { content: true, tab: true } },
    ]),
  ).toEqual({
    samples: 5,
    milestones: {
      content: { firstObservedMs: 32, stableObservedMs: 64 },
      tab: { firstObservedMs: 48, stableObservedMs: 80 },
    },
    all: { firstObservedMs: 48, stableObservedMs: 80 },
  })
})

test("reports missing stability when a milestone appears in the final samples", () => {
  expect(
    summarizeNavigationMilestones([
      { observedAtMs: 16, milestones: { content: false } },
      { observedAtMs: 32, milestones: { content: true } },
    ]),
  ).toEqual({
    samples: 2,
    milestones: { content: { firstObservedMs: 32, stableObservedMs: null } },
    all: { firstObservedMs: 32, stableObservedMs: null },
  })
})

test("measures a navigation milestone after the trigger is clicked", async () => {
  const page = testPage()

  try {
    const result = await measureNavigationMilestones(page, {
      triggerSelector: "#trigger",
      milestones: {
        content: { selector: "#content" },
      },
      navigate: async () => {
        page.click()
        page.showContent()
      },
    })

    expect(result.summary.samples).toBeGreaterThanOrEqual(3)
    expect(result.summary.milestones.content.firstObservedMs).toBeNumber()
    expect(result.summary.milestones.content.stableObservedMs).toBeNumber()
    expect(result.summary.all.firstObservedMs).toBeNumber()
    expect(result.summary.all.stableObservedMs).toBeNumber()
  } finally {
    page.restore()
  }
})

function testPage() {
  let listener: ((event: Event) => void) | undefined
  let contentVisible = false
  const previous = {
    document: globalThis.document,
    Element: globalThis.Element,
    window: globalThis.window,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    performance: globalThis.performance,
  }
  class TestElement {
    textContent = ""
    style = { visibility: "visible", display: "block" }
    constructor(
      readonly selector: string,
      readonly visible = true,
    ) {}
    closest(selector: string) {
      return selector === this.selector ? this : null
    }
    getBoundingClientRect() {
      return {
        width: this.visible ? 1 : 0,
        height: this.visible ? 1 : 0,
      }
    }
  }
  globalThis.Element = TestElement as unknown as typeof Element
  globalThis.window = globalThis as typeof window
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    setTimeout(callback, 0)
    return 0
  }) as typeof requestAnimationFrame
  globalThis.performance = {
    now: (() => {
      let now = 0
      return () => (now += 16)
    })(),
    mark: () => {},
  } as unknown as Performance
  globalThis.document = {
    addEventListener: (_type: string, callback: (event: Event) => void) => {
      listener = callback
    },
    querySelector: (selector: string) => (selector === "#content" && contentVisible ? new TestElement(selector) : null),
    querySelectorAll: (selector: string) =>
      selector === "#content" && contentVisible ? [new TestElement(selector)] : [],
  } as unknown as Document

  const page = {
    evaluate: async (callback: (input?: unknown) => unknown, input?: unknown) => callback(input),
    waitForFunction: async (callback: () => boolean) => {
      while (!callback()) await new Promise((resolve) => setTimeout(resolve, 0))
    },
    click: () => {
      listener?.({ target: new TestElement("#trigger") } as unknown as Event)
    },
    showContent: () => {
      contentVisible = true
    },
    restore: () => {
      globalThis.document = previous.document
      globalThis.Element = previous.Element
      globalThis.window = previous.window
      globalThis.requestAnimationFrame = previous.requestAnimationFrame
      globalThis.performance = previous.performance
    },
  }

  return page as unknown as Page & {
    click: () => void
    showContent: () => void
    restore: () => void
  }
}
