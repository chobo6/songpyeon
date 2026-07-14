import type { Color, Role } from "../game/colors";
import { COLOR_TOKEN } from "../game/colors";
import { SLOT_ORDER, buttonPanelSlots } from "../game/buttonPanel";
import styles from "./ButtonPanel.module.css";

export function ButtonPanel({
  role,
  disabled,
  onPress,
}: {
  role: Role;
  disabled: boolean;
  onPress: (color: Color) => void;
}) {
  const slots = buttonPanelSlots(role);

  return (
    <div className={styles.panelBg}>
      <div className={styles.panel}>
        {SLOT_ORDER.map((position) => {
          const color = slots[position];
          const positionClass = styles[position];
          if (!color) {
            return <div key={position} className={`${styles.empty} ${positionClass}`} />;
          }
          return (
            <button
              key={position}
              type="button"
              aria-label={color}
              disabled={disabled}
              onClick={() => onPress(color)}
              className={`${styles.button} ${positionClass}`}
              style={{ backgroundImage: `url(${COLOR_TOKEN[color]})` }}
            />
          );
        })}
      </div>
    </div>
  );
}
