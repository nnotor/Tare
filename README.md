# Tare

**A free, private nutrition coach that learns from your real intake and weight.**

Tare tracks calories and macros, scans packaged foods, estimates your actual energy expenditure, and updates your targets every week. It runs as an installable web app, works offline, and keeps your log on your device.

Everything is free. There are no subscriptions, paywalls, or accounts.

**[Open Tare](https://nnotor.github.io/Tare/)**

## Features

### Adaptive coaching

- Estimates daily expenditure from your logged food and weight trend over the last 28 days
- Starts with the Mifflin-St Jeor formula, then shifts toward your real data as you log
- Offers updated calorie, protein, carb, and fat targets at a weekly check-in
- Bases each adjustment on what you actually ate and weighed, so a week of missed targets does not skew it
- Includes Coached, Collaborative, and Manual program modes
- Lets you set your own protein, carb, and fat goals from the Log screen
- Lets you turn coaching off and use Tare only for macro tracking, with or without your own targets
- Supports balanced, low-carb, keto, and carb-focused plans
- Sets high, low, normal, and fasting days while keeping your weekly average
- Supports goals from losing 1.5% to gaining 1% of body weight per week, from presets or a custom amount per week
- Estimates when you will reach a goal weight, and offers to switch to maintenance when you get there
- Dynamic maintenance keeps intake at your expenditure while your trend stays within about 1.5 lb (0.7 kg) of the weight you want to hold, and adds a small deficit or surplus when it drifts outside that range
- An optional expenditure modifier phases in the change in expenditure that usually follows a new goal, about 4% for each 1% per week, over two weeks, before the scale shows it
- Lets you leave incomplete days out of the estimate

### Fast food logging

- Describe a meal in plain words, such as "2 eggs, toast with butter, black coffee", or dictate it with your keyboard's microphone, then review the matched foods and amounts before logging
- Scan EAN-13, EAN-8, UPC-A, and UPC-E barcodes with the live camera or a photo
- Look up new products through Open Food Facts and review the values before logging
- Read Nutrition Facts labels from a photo on your device
- Search more than 7,500 USDA foods on your device, even offline or on a VPN
- Get typo-tolerant autocomplete and smart suggestions based on what you usually eat at each meal
- Build recipes, add custom foods, and remember corrected barcode values
- Import a recipe's ingredients by pasting the list from a website or photographing a cookbook page
- Log a recipe as separate ingredients, or split a logged recipe, to change it for one meal without changing the saved recipe
- Log by calories or macros: enter 300 calories or 40 g of protein and Tare shows how many grams (or ml) to eat whenever the food's weight is known, in search, on scanned products, and in phrases like "300 calories of rice"
- Quick add calories or macros without naming a food
- Change a serving in g, ml, or oz and automatically rescale its nutrition
- See a small icon for each food, such as grain for oats or a milk carton for whey protein
- Record the time of each food automatically, and change it when you log something later
- Edit past entries, including their amount, nutrition, meal, date, and time
- Undo accidental food deletions
- Log by meal or use one simple food list
- Copy and paste foods, meals, or entire days

### Progress trends

- Compare daily scale weight with a smoothed trend weight
- See calories eaten alongside estimated expenditure
- Review weekly weight change and average intake
- View ranges from 2 weeks to 1 year
- Track logging and weigh-in streaks
- Compare 7-day, 30-day, and all-time nutrition averages, plus weekly and monthly averages with trend weight change
- See how often you land within 10% of your calorie target and meet your protein target
- See top food contributors and calorie timing by meal or by time of day
- Review micronutrients on the Log screen and while adding foods, when food data includes them
- Find foods high in protein, fiber, potassium, calcium, iron, vitamin C, or vitamin D, ranked per calorie or per 100 g, and log one with a tap

### Fasting timer

- Start a fast now, or backdate it to your last logged food
- Watch elapsed time and progress toward a 12 to 36 hour goal
- Adjust the start time if you forgot to start the timer
- Review your recent fasts on the Log screen
- Hide the timer from Log if you do not fast

### Body tracking

- Log body measurements
- Track period days and estimate cycle length
- Keep progress photos on your device

### Built for phones

- Installs to your home screen and opens full screen
- Opens offline after the first online launch
- Adapts to compact, foldable, and desktop screens
- On iPhone Duo's outer screen, follows Apple's layout for side controls: back, forward, and close at the top below the status area, tabs at the bottom, and layouts sized to the space the rail leaves, on either side and in Split View. When the rail is too short for both, back and forward move to the page header
- Keeps titles and buttons clear of rounded screen corners and the home indicator, and lists the screen size and safe areas iOS reports under **Plan** to help diagnose layout problems on a particular phone
- Supports light and dark mode
- Uses camera zoom, flashlight, and continuous focus when the device allows it

## Install on iPhone

1. Open [Tare](https://nnotor.github.io/Tare/) in Safari.
2. Tap **Share**, then **Add to Home Screen**.
3. Open Tare from the new icon and set up your plan there.

Home-screen apps use Safari's camera permission. If scanning is blocked, go to **Settings > Apps > Safari > Camera** and choose **Ask** or **Allow**.

## Install on Android

1. Open [Tare](https://nnotor.github.io/Tare/) in Chrome.
2. Open the **⋮** menu and choose **Add to Home screen** or **Install app**.
3. Open Tare from the new icon and set up your plan there.

## Your data

- Save a full backup file and restore it on any device
- Export spreadsheets (CSV) of your food log, daily totals, and fasts. They open in Excel, Numbers, and Google Sheets.

## Privacy

Tare has no accounts, analytics, ads, or app server. Your food log, weight, body stats, targets, and saved foods stay in your browser's storage on your device.

Some requests still leave your device:

| Service | When it is used | What it receives |
| --- | --- | --- |
| GitHub Pages | Loading or updating the app | Standard connection details, such as IP address and browser type |
| jsDelivr | Downloading the barcode reader, or the text reader for labels and recipe photos | Standard connection details |
| Open Food Facts | Looking up a new barcode | The barcode number and standard connection details |

Food search and meal descriptions are matched on your device, so what you type is not sent to any service.

Camera images, label photos, recipe photos, and progress photos are processed on your device and are not uploaded by Tare.

## Back up your data

Because your log exists only on your device, clearing browser data or removing the home-screen app can erase it. Use **Plan > Back up** regularly and keep the file somewhere private. Backup files are not encrypted and do not include progress photos.

## How the estimate works

Tare compares your average logged intake with the slope of your weight over the last 28 days, counting each kilogram of change as about 7,700 kcal. It needs at least 7 logged days and 4 weigh-ins across a week before it starts using your data, and its confidence grows as you log more, reaching full confidence after about three weeks of steady logging.

With the expenditure modifier on, a goal change also shifts the estimate by about 4% for each 1% per week of change, phased in over two weeks. The part of the estimate that comes from your data already reflects some of that shift as new days arrive, so Tare adds only the part your data has not caught up to yet.

Accurate food logging and regular weigh-ins produce the best estimates.

## Built with

- HTML, CSS, and JavaScript with no build step
- [ZXing](https://github.com/zxing-js/library) for barcode reading
- [Tesseract.js](https://github.com/naptha/tesseract.js) for label reading
- [Open Food Facts](https://world.openfoodfacts.org/) for barcode product data
- [USDA FoodData Central](https://fdc.nal.usda.gov/) Foundation Foods and SR Legacy data for on-device food search
- A service worker for offline use

## Disclaimer

Tare is not medical advice. Food values are estimates, and crowd-sourced product data can be wrong, so compare it with the package label. Talk with a clinician before changing your diet if you are pregnant, have diabetes, or have a history of disordered eating.
