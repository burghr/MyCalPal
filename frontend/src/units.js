// Common serving unit options.
export const SERVING_UNITS = [
  'serving', 'g', 'oz', 'ml', 'fl oz',
  'cup', 'tbsp', 'tsp',
  'piece', 'slice', 'scoop',
  'packet', 'can', 'bottle', 'bar',
]

// Body weight units. Stored as kg server-side; UI toggles display.
const KG_PER_LB = 0.45359237

export function getWeightUnit() {
  return localStorage.getItem('weightUnit') || 'lb'
}

export function setWeightUnit(unit) {
  localStorage.setItem('weightUnit', unit)
}

export function kgToDisplay(kg, unit = getWeightUnit()) {
  if (kg == null) return null
  return unit === 'lb' ? kg / KG_PER_LB : kg
}

export function displayToKg(value, unit = getWeightUnit()) {
  const n = parseFloat(value)
  if (!n) return null
  return unit === 'lb' ? n * KG_PER_LB : n
}

export function formatServing(food) {
  const amt = food.serving_amount ?? 1
  const unit = food.serving_unit || 'serving'
  // Drop trailing ".0"
  const pretty = Number.isInteger(amt) ? String(amt) : amt.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `${pretty} ${unit}`
}
