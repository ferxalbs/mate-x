export function exposeKey(env = process.env) {
  const key = env.RAINY_API_KEY ?? "";
  console.log(`key=${key}`);
  return key;
}
