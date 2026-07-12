export type PigColor = "red" | "orange" | "yellow" | "purple";
export type RabbitColor = "mint" | "green" | "blue" | "pink";
export type Color = PigColor | RabbitColor;
export type Role = "pig" | "rabbit";

export const PIG_COLORS: readonly PigColor[] = ["red", "orange", "yellow", "purple"];
export const RABBIT_COLORS: readonly RabbitColor[] = ["mint", "green", "blue", "pink"];

export function colorRole(color: Color): Role {
  return (PIG_COLORS as readonly Color[]).includes(color) ? "pig" : "rabbit";
}
