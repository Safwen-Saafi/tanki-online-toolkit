# augment-ids

Makes the list the extension uses to name the augments in the battle tab (build-plan 18d). In the battle tab the game shows each player's augments only as numbers. `extension/data/augment_ids.json` turns each number into the turret or hull it belongs to and the augment's name in English and in Russian, and the extension then finds the augment's wiki text the way the garage does.

The list comes from the game itself: in the garage, once any turret's Augments tab has been opened, the game holds every augment of every turret and hull, with its number and its name. These tools read that list and save it. They are not part of the extension and never ship in the zip. They have no dependencies (Node 18 or later), and they never commit, build or touch anything but `extension/data/augment_ids.json`.

## When to run them

When the game adds augments, about every two months. A new augment shows "No information yet" in the battle tab until the list is made again.

## Steps

1. Open the game in **English**, go to the garage and open any turret's **Augments** tab.
2. Press F12, open the Console, paste the whole of `capture.js` and press Enter. It says how many augments it found and saves `augment-ids-EN.json` in your Downloads folder.
3. Switch the game to **Russian** (the page reloads), open a turret's Augments tab again, and paste `capture.js` again. It saves `augment-ids-RU.json`.
4. From the repo folder, merge both files into the list:

   ```
   node scripts/augment-ids/merge.mjs "%USERPROFILE%\Downloads\augment-ids-EN.json" "%USERPROFILE%\Downloads\augment-ids-RU.json"
   ```

   It checks every line first and refuses a broken file without writing anything. Then it prints, for each file, how many augments are new, renamed or unchanged, and how many hull items it saw (11 on 2026-11-08). Add `--dry-run` to see that without writing.
5. `npm run build`, reload the extension, and make a release when you want it out.

## What is in the list

```json
{ "schemaVersion": 1, "augments": { "920005770330": { "item": "railgun", "EN": "Large caliber rounds", "RU": "..." } } }
```

`item` is the turret's name as the augment data uses it, or `hulls` for every hull. The turret's number is turned into its name by the table at the top of `merge.mjs`, read from the game's script on 2026-11-08; if the game ever adds a turret, add its number there.
