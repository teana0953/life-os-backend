import type { WaterRepository } from "../domain/water-repository";

export interface WaterDay {
  day: string;
  totalMl: number;
  targetMl: number;
  remainingMl: number;
}

/**
 * Use case: a day's water total, resolved target, and remaining (target - total,
 * which may be negative). Target resolution mirrors the diet daily target: the
 * day's own set target if one exists, otherwise the target carried forward from
 * the most recent earlier day that has one, otherwise zero.
 */
export async function getWaterDay(repository: WaterRepository, userId: string, day: string): Promise<WaterDay> {
  const exact = await repository.getTarget(userId, day);
  const carry = exact ? null : await repository.getLatestTargetOnOrBefore(userId, day);
  const targetMl = exact ? exact.targetMl : carry ? carry.targetMl : 0;

  const intake = await repository.getIntake(userId, day);
  const totalMl = intake?.totalMl ?? 0;

  return { day, totalMl, targetMl, remainingMl: targetMl - totalMl };
}
