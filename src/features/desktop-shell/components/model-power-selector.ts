import type { RainyModelCatalogEntry } from '../../../contracts/rainy';

export interface ModelPowerOption {
  model: RainyModelCatalogEntry;
  power: number;
}

const SUPPORTED_FAMILY = /(?:gpt[-\s/]?5\.6|claude)/i;

export function buildModelPowerOptions(catalog: RainyModelCatalogEntry[]): ModelPowerOption[] {
  return catalog
    .filter((model) => SUPPORTED_FAMILY.test(`${model.id} ${model.label}`))
    .map((model) => ({ model, power: getModelPower(model) }))
    .toSorted((a, b) => a.power - b.power || getModelPrice(a.model) - getModelPrice(b.model) || a.model.label.localeCompare(b.model.label));
}

export function getModelPowerLabel(index: number, total: number) {
  if (index <= 0) return 'Faster';
  if (index >= total - 1) return 'Smartest';
  return 'Balanced';
}

function getModelPower(model: RainyModelCatalogEntry) {
  const name = `${model.id} ${model.label}`.toLowerCase();
  let power = 20;

  if (/luna[-\s]?light|haiku|flash|mini|light/.test(name)) power = 0;
  else if (/luna/.test(name)) power = 10;
  else if (/terra|sonnet/.test(name)) power = 20;
  else if (/sol|opus/.test(name)) power = 30;

  if (/(?:^|[-_/\s])(pro|max|ultra)(?:$|[-_/\s])/.test(name)) power += 10;
  return power;
}

function getModelPrice(model: RainyModelCatalogEntry) {
  const input = Number(model.pricing?.input ?? 0);
  const output = Number(model.pricing?.output ?? 0);
  return (Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0);
}
