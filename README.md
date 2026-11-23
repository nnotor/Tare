# Tare

**A free, private nutrition coach that learns from your real intake and weight.**

Tare tracks calories and macros, scans packaged foods, estimates your actual energy expenditure, and updates your targets every week. It runs as an installable web app, works offline, and keeps your log on your device.

**[Open Tare](https://nnotor.github.io/Tare/)**

## Features

### Adaptive coaching

- Estimates daily expenditure from your logged food and weight trend over the last 28 days
- Starts with the Mifflin-St Jeor formula, then shifts toward your real data as you log
- Offers updated calorie, protein, carb, and fat targets at a weekly check-in
- Supports goals from losing 1% to gaining 0.5% of body weight per week
- Lets you leave incomplete days out of the estimate

### Fast food logging

- Scan EAN-13, EAN-8, UPC-A, and UPC-E barcodes with the live camera or a photo
- Look up new products through Open Food Facts and review the values before logging
- Search 102 built-in foods, recent foods, and your saved foods
- Add custom foods and remember corrected barcode values
- Log by meal, adjust servings, and copy the previous day

### Progress trends

- Compare daily scale weight with a smoothed trend weight
- See calories eaten alongside estimated expenditure
- Review weekly weight change and average intake
- View ranges from 2 weeks to 1 year

### Built for phones

- Installs to your home screen and opens full screen
- Opens offline after the first online launch
- Adapts to compact, foldable, and desktop screens
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

## Privacy

Tare has no accounts, analytics, ads, or app server. Your food log, weight, body stats, targets, and saved foods stay in your browser's storage on your device.

Some requests still leave your device:

| Service | When it is used | What it receives |
| --- | --- | --- |
| GitHub Pages | Loading or updating the app | Standard connection details, such as IP address and browser type |
| jsDelivr | Downloading the scanner library | Standard connection details |
| Open Food Facts | Looking up a product you have not saved | The barcode number and standard connection details |

Camera images are processed on your device and are not uploaded by Tare.

## Back up your data

Because your log exists only on your device, clearing browser data or removing the home-screen app can erase it. Use **Plan > Back up** regularly and keep the file somewhere private. Backup files are not encrypted.

## How the estimate works

Tare compares your average logged intake with the slope of your weight over the last 28 days, counting each kilogram of change as about 7,700 kcal. It needs at least 7 logged days and 4 weigh-ins across a week before it starts using your data, and its confidence grows as you log more.

Accurate food logging and regular weigh-ins produce the best estimates.

## Built with

- HTML, CSS, and JavaScript with no build step
- [ZXing](https://github.com/zxing-js/library) for barcode reading
- [Open Food Facts](https://world.openfoodfacts.org/) for product data
- A service worker for offline use

## Disclaimer

Tare is not medical advice. Food values are estimates, and crowd-sourced product data can be wrong, so compare it with the package label. Talk with a clinician before changing your diet if you are pregnant, have diabetes, or have a history of disordered eating.
