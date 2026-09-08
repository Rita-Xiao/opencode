import type { Page } from "@playwright/test"

export type NavigationMilestoneSample = {
  observedAtMs: number
  milestones: Record<string, boolean>
}

export function summarizeNavigationMilestones(samples: NavigationMilestoneSample[]) {
  const names = Object.keys(samples[0]?.milestones ?? {})
  const summarize = (matches: (sample: NavigationMilestoneSample) => boolean) => {
    const first = samples.find(matches)
    const stable = samples.findIndex(
      (sample, index) =>
        index + 2 < samples.length && matches(sample) && matches(samples[index + 1]!) && matches(samples[index + 2]!),
    )
    return {
      firstObservedMs: first?.observedAtMs ?? null,
      stableObservedMs: stable === -1 ? null : samples[stable + 2]!.observedAtMs,
    }
  }
  return {
    samples: samples.length,
    milestones: Object.fromEntries(
      names.map((name) => [name, summarize((sample) => sample.milestones[name] === true)]),
    ),
    all: summarize((sample) => names.every((name) => sample.milestones[name] === true)),
  }
}

type NavigationMilestoneProbe = {
  samples: NavigationMilestoneSample[]
  stop: () => void
}

type NavigationMilestoneHelpers = {
  getCurrentMilestones: (milestones: Record<string, { selector: string; visible?: boolean }>) => Record<string, boolean>
  updateMilestoneStreak: (input: {
    name: string
    value: boolean
    streaks: Map<string, number>
    marked: Set<string>
  }) => void
  updateAllMilestoneMarks: (input: {
    current: Record<string, boolean>
    streaks: Map<string, number>
    marked: Set<string>
  }) => void
}

type NavigationMilestoneWindow = Window & {
  __navigationMilestoneHelpers?: NavigationMilestoneHelpers
  __navigationMilestones?: NavigationMilestoneProbe
}

export async function measureNavigationMilestones(
  page: Page,
  input: {
    triggerSelector: string
    milestones: Record<string, { selector: string; visible?: boolean }>
    navigate: () => Promise<void>
  },
) {
  await page.evaluate(setupNavigationMilestoneHelpers)
  await page.evaluate(setupNavigationMilestoneTracking, {
    triggerSelector: input.triggerSelector,
    milestones: input.milestones,
  })
  await input.navigate()

  await page.waitForFunction(() => {
    const samples = (window as Window & { __navigationMilestones?: NavigationMilestoneProbe }).__navigationMilestones
      ?.samples
    if (!samples || samples.length < 3) return false
    return samples.slice(-3).every((sample) => Object.values(sample.milestones).every(Boolean))
  })
  const samples = await page.evaluate(() => {
    const probe = (window as Window & { __navigationMilestones?: NavigationMilestoneProbe }).__navigationMilestones!
    probe.stop()
    return probe.samples
  })

  return { summary: summarizeNavigationMilestones(samples), samples }
}

function setupNavigationMilestoneHelpers() {
  const visible = (selector: string) =>
    [...document.querySelectorAll<HTMLElement>(selector)].some((element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
    })

  ;(window as NavigationMilestoneWindow).__navigationMilestoneHelpers = {
    getCurrentMilestones(milestones) {
      return Object.fromEntries(
        Object.entries(milestones).map(([name, milestone]) => [
          name,
          milestone.visible === false ? !document.querySelector(milestone.selector) : visible(milestone.selector),
        ]),
      )
    },
    updateMilestoneStreak(input) {
      if (!input.value) {
        input.streaks.set(input.name, 0)
        return
      }
      if (!input.marked.has(`${input.name}.first`)) {
        performance.mark(`opencode.navigation.${input.name}.first`)
        input.marked.add(`${input.name}.first`)
      }
      const streak = (input.streaks.get(input.name) ?? 0) + 1
      input.streaks.set(input.name, streak)
      if (streak === 3) performance.mark(`opencode.navigation.${input.name}.stable`)
    },
    updateAllMilestoneMarks(input) {
      const all = Object.values(input.current).every(Boolean)
      const allStreak = all ? (input.streaks.get("all") ?? 0) + 1 : 0
      input.streaks.set("all", allStreak)
      if (all && !input.marked.has("all.first")) {
        performance.mark("opencode.navigation.all.first")
        input.marked.add("all.first")
      }
      if (allStreak === 3) {
        performance.mark("opencode.navigation.all.stable")
      }
    },
  }
}

function setupNavigationMilestoneTracking(input: {
  triggerSelector: string
  milestones: Record<string, { selector: string; visible?: boolean }>
}) {
  const samples: NavigationMilestoneSample[] = []
  const streaks = new Map<string, number>()
  const marked = new Set<string>()
  const helpers = (window as NavigationMilestoneWindow).__navigationMilestoneHelpers!
  let started: number | undefined
  let running = true

  const sample = () => {
    if (!running || started === undefined) return

    requestAnimationFrame(() => {
      setTimeout(() => {
        if (!running || started === undefined) return
        const current = helpers.getCurrentMilestones(input.milestones)

        samples.push({
          observedAtMs: performance.now() - started,
          milestones: current,
        })
        Object.entries(current).forEach(([name, value]) => {
          helpers.updateMilestoneStreak({ name, value, streaks, marked })
        })
        helpers.updateAllMilestoneMarks({ current, streaks, marked })
        sample()
      }, 0)
    })
  }

  document.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element) || !event.target.closest(input.triggerSelector)) return
      started = performance.now()
      performance.mark("opencode.navigation.click")
      sample()
    },
    { capture: true, once: true },
  )
  ;(window as NavigationMilestoneWindow).__navigationMilestones = {
    samples,
    stop: () => {
      running = false
    },
  }
}
