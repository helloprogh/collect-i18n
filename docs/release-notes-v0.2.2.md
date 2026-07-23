# Collect I18n v0.2.2

This patch keeps capture screenshots readable when a Key Path is long.

- Removes the visible Key Path label from the temporary screenshot marker.
- Keeps only the red border around the rendered target text.
- Keeps the Key Path in runtime evidence, SQLite state, task APIs, and the fourth Excel column.
- Marks the temporary capture overlay as presentation-only and hidden from accessibility APIs.

The change was verified against the real 601-key Vue benchmark: generated screenshots contain the target-text border without a Key Path label or additional covering text.
