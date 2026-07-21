/** Nomes "humanos" para bots disfarçados (decisão do GDD). */
const BOT_NAMES = [
  "Falcao77",
  "xLobo",
  "Pedrin",
  "N1ghtOwl",
  "KZika",
  "MatheusBR",
  "Sombra_",
  "Rafa010",
  "TioPatinhas",
  "gustavo_hz",
  "DedoNervoso",
  "Krakatoa",
  "Lag4tixa",
  "juninho22",
  "MiraTorta",
  "ZeroCal",
];

/** Sorteia `count` nomes únicos. */
export function pickBotNames(count: number): string[] {
  const pool = [...BOT_NAMES];
  const result: string[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    result.push(pool.splice(idx, 1)[0]);
  }
  return result;
}
