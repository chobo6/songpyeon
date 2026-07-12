import type { Color, Role } from "../game/colors";
import { COLOR_HEX } from "../game/colors";
import { SLOT_ORDER, buttonPanelSlots } from "../game/buttonPanel";
import styles from "./ButtonPanel.module.css";

export function ButtonPanel({
  role,
  dueColor,
  disabled,
  onPress,
}: {
  role: Role;
  dueColor: Color | undefined;
  disabled: boolean;
  onPress: (color: Color) => void;
}) {
  const slots = buttonPanelSlots(role);

  return (
    <div className={styles.panel}>
      {SLOT_ORDER.map((position) => {
        const color = slots[position];
        if (!color) {
          return <div key={position} className={styles.empty} />;
        }
        const isDue = color === dueColor;
        return (
          <button
            key={position}
            type="button"
            aria-label={color}
            disabled={disabled}
            onClick={() => onPress(color)}
            className={isDue ? `${styles.button} ${styles.due}` : styles.button}
            style={{ background: COLOR_HEX[color] }}
          />
        );
      })}
    </div>
  );
}
