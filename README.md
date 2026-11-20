# Orbital Lab

Interactive 3D N-body sandbox built with TypeScript, Three.js, and Vite.

## Run locally

Requires Node.js 22.12 or later in the Node 22 release line, or Node.js 24.

```sh
npm ci
npm run dev
npm test
npm run build
```

The production build is a static site in `dist/`. Use `npm run preview` to serve it locally.

## Deploy to GitHub Pages

Use **Deploy from a branch**, with **main** and **/ (root)** as the source. The repository root opens the checked-in production build in `site/`.

After editing the app, run `npm run build:pages` and commit the updated `site/` alongside the source changes. GitHub Pages serves these files directly.

## Controls

- Choose a body from Bodies to jump to its close-up. In free flight, click a viewport label for an assisted approach. Use System overview to pull back and the scale button to use proportional distances and radii.
- Drag to orbit, scroll or pinch to zoom, and right-drag to pan.
- Choose Fly or press F for free flight. Drag to look around, move with WASD or the arrow keys, use Q/E for altitude, and hold Shift to boost. Escape returns to orbit controls. Touch devices provide hold-to-move buttons.
- Press Space to pause or resume. Press R to reverse integration. The step button advances one fixed outer step while paused.
- Choose a launch type, arm the tool, then pull back on the ecliptic. The preview shows the osculating orbit before release. A click without a pull assigns circular speed. Escape cancels.
- Turn on Gravity grid to see a visualization of the softened gravitational potential. The mass slider spans 0.01–100 times the selected body's starting mass.

## Simulation and data

The simulation uses AU, days, and solar masses. Each simulated body participates in pairwise Newtonian gravity. Velocity Verlet uses a fixed 1/12-day outer step and a nested fixed step for close pairs. Stars, planets, and moons share one radius multiplier in Cinematic mode. True scale also draws orbital distances at the same scale as those radii. Glyphs, lines, the gravity grid, and other visualization overlays use display scales. The 2,450 instanced belt rocks follow analytic heliocentric orbits as a visual test-particle population.

Orbital predictions are instantaneous osculating conics recalculated from the N-body state. The Solar System starts at 00:00 UTC on 21 May 2009 at 1 simulated second per second. The planets, moons, and Voyager 1 use parent-relative Horizons vectors for that epoch. Webb is represented by an illustrative Earth-adjacent orbit. TRAPPIST-1 uses published masses and radii with illustrative starting phases. Binary Stars and Black Hole Flyby are sandbox scenarios. Close gravity is softened and the lensing effect is illustrative. Reverse integrates the current state backward and can restore recent tidal breakups. Mass edits and launches reset breakup history. The maximum warp rate depends on hardware under heavy load.

- Planetary elements and constants from [NASA/JPL Solar System Dynamics](https://ssd.jpl.nasa.gov/planets/approx_pos.html).
- Planet, moon, and Voyager 1 state vectors from [NASA/JPL Horizons](https://ssd.jpl.nasa.gov/horizons/).
- TRAPPIST-1 parameters from [Agol et al. (2021)](https://doi.org/10.3847/psj/abd022).
- Planetary, ring, and Milky Way image textures from [Solar System Scope](https://www.solarsystemscope.com/textures/) by INOVE, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Images are bundled and shaded in the application. The Earth day, Jupiter, and Saturn maps were downsampled from the 8K originals to 4K. The Earth normal and reflectance maps were converted from TIFF to JPEG.
- The Uranus ring alpha map uses Voyager 2 PPS beta Per ingress optical depths (PU2P01XI, 5 km sampling). The map suppresses low-confidence samples and widens narrow features for display. [NASA PDS Ring-Moon Systems Node](https://pds-rings.seti.org/voyager/pps/profiles.html).