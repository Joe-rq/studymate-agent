import type { StudyPlan } from './planner.js';
import type { Mistake } from './mistake_analyzer.js';

export function adjustPlan(plan: StudyPlan, mistakes: Mistake[]): StudyPlan {
  const weakNodes = [...new Set(mistakes.map((m) => m.nodeId))];
  const adjusted: StudyPlan = JSON.parse(JSON.stringify(plan));

  for (const day of adjusted.schedule) {
    for (const task of day.tasks) {
      if (weakNodes.includes(task.nodeId) && task.type === 'review') {
        task.duration += 10;
      }
    }
  }

  return adjusted;
}
