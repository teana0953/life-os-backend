export type ExerciseCategory = "aerobic" | "anaerobic";

export interface ExerciseActivity {
  id: string;
  name: string;
  category: ExerciseCategory;
  /** Descriptive intensity label (e.g. "8km/hr"); empty string when none. */
  intensity: string;
}

/**
 * Fixed, read-only, shared activity library (v1). A small set of representative
 * activities; not user-editable. IDs are stable short slugs.
 */
export const EXERCISE_ACTIVITIES: readonly ExerciseActivity[] = [
  { id: "jogging", name: "慢跑", category: "aerobic", intensity: "8km/hr" },
  { id: "brisk-walking", name: "快走", category: "aerobic", intensity: "" },
  { id: "cycling", name: "騎車", category: "aerobic", intensity: "20km/hr" },
  { id: "swimming", name: "游泳", category: "aerobic", intensity: "" },
  { id: "jump-rope", name: "跳繩", category: "aerobic", intensity: "" },
  { id: "stair-climbing", name: "登階", category: "aerobic", intensity: "" },
  { id: "weight-training", name: "重量訓練", category: "anaerobic", intensity: "" },
  { id: "squats", name: "深蹲", category: "anaerobic", intensity: "" },
  { id: "push-ups", name: "伏地挺身", category: "anaerobic", intensity: "" },
  { id: "yoga", name: "瑜伽", category: "anaerobic", intensity: "" },
];

/** Looks up an activity by id in the static library; undefined when not found. */
export function findActivity(id: string): ExerciseActivity | undefined {
  return EXERCISE_ACTIVITIES.find((activity) => activity.id === id);
}
