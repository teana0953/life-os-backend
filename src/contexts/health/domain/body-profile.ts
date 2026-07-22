export interface BodyProfile {
  userId: string;
  /** Height in centimetres; null until the user enters it. */
  heightCm: number | null;
  /** Target weight in kilograms; null until the user enters it. */
  targetWeightKg: number | null;
}
