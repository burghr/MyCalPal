// Mifflin-St Jeor BMR + activity multiplier TDEE.
// Returns null if required fields missing.

export const ACTIVITY_LEVELS = [
  { value: 'sedentary', label: 'Sedentary (little/no exercise)', mult: 1.2 },
  { value: 'light', label: 'Light (1-3 days/wk)', mult: 1.375 },
  { value: 'moderate', label: 'Moderate (3-5 days/wk)', mult: 1.55 },
  { value: 'active', label: 'Active (6-7 days/wk)', mult: 1.725 },
  { value: 'very_active', label: 'Very active (hard exercise + physical job)', mult: 1.9 },
]

export const GOAL_ADJUSTMENTS = {
  maintain: 0,
  lose: -500,   // ~1 lb/week
  gain: 300,    // lean gain
}

export function calcBMR({ weight_kg, height_cm, age, sex }) {
  if (!weight_kg || !height_cm || !age || !sex) return null
  const base = 10 * weight_kg + 6.25 * height_cm - 5 * age
  return sex === 'male' ? base + 5 : base - 161
}

export function calcTDEE({ weight_kg, height_cm, age, sex, activity_level }) {
  const bmr = calcBMR({ weight_kg, height_cm, age, sex })
  if (!bmr) return null
  const mult = ACTIVITY_LEVELS.find(a => a.value === activity_level)?.mult ?? 1.2
  return bmr * mult
}

export function suggestCalorieGoal(profile) {
  const tdee = calcTDEE(profile)
  if (!tdee) return null
  const adj = GOAL_ADJUSTMENTS[profile.goal_type] ?? 0
  return Math.round(tdee + adj)
}

// Unit conversion helpers for UI
export const lbToKg = (lb) => lb * 0.45359237
export const kgToLb = (kg) => kg / 0.45359237
export const inToCm = (inches) => inches * 2.54
export const cmToIn = (cm) => cm / 2.54
