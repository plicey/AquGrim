# AquGrim runtime performance comparison

Measured 2026-11-03 on Intel Core i5-1135G7 (8 logical CPUs), Electron 11.5.0 / Chromium 87.0.4280.141, 960×530 content window. Bundled Ruffle 0.7.1 versus bundled PPAPI Flash. User logged in and explicitly started each measurement after entering shadowbattleon, cell Enter. One sequential 15-second sample per runtime, Ruffle first, Flash second. Both started and ended connected in that map/cell.

## Results

- AS3 frame rate: Ruffle 20.17 FPS; Flash 17.90 FPS. Ruffle 12.7% higher; both target 24 FPS.
- 95th percentile frame interval: Ruffle 68 ms; Flash 83 ms. Lower is better.
- Mean aggregate Electron-reported CPU metric: Ruffle 16.44; Flash 38.83. Ruffle 57.7% lower. Same metric/process aggregation in both runs; do not interpret as a portable single-core CPU percentage.
- Mean summed process working sets: Ruffle 1162.4 MiB; Flash 798.1 MiB. Ruffle 45.6% higher. Summed working sets include shared pages more than once; these are not unique physical-memory totals.
- Synchronous shared-domain read through ExternalInterface, 500 calls in five batches: Ruffle 0.0217 ms/call; Flash 0.7771 ms/call. This is page-to-SWF overhead, excluding Electron IPC and complete bot-command execution.

## Method and limits

A temporary copy of AquaBridge adds only an ENTER_FRAME timer and reset/read callbacks. Frame rate describes AS3 event delivery, not independently measured GPU presentation. CPU and working-set metrics include the benchmark app's subprocesses; the Ruffle socket relay runs in its main process. Identical runtime window settings, GPU forcing disabled, background throttling disabled, same instrumented bridge and upstream game. The user selected map/room manually; exact server population, outfit/animation state, and background system load were not controlled. No combat workload, repeated trials, long-duration stability, or newer-Electron Ruffle test was performed. The first automatic/title samples were discarded because they were not matched gameplay measurements.

An earlier Ruffle renderer crashed with GPU rasterization/zero-copy forcing enabled. The successful matched Ruffle run used default GPU choices. That crash is a stability observation, not proof of its cause or that disabling those flags fixes it permanently. The live Ruffle run also logged a CORS-blocked legacy quest-tracking request; it remained connected throughout the sample.

## Conclusion

Ruffle delivered higher AS3 frame rate and lower reported CPU in this scene; Flash used less working-set memory. This single short comparison does not establish a winner for crowded combat or production stability. Ruffle's earlier renderer crash must be investigated before treating it as the reliable default.

Raw, sanitized measurements: [ruffle-performance-results.json](ruffle-performance-results.json). Temporary harness and instrumented bridge: `/tmp/aqugrim-runtime-bench/`; production runtime code was unchanged during measurement.


## Runtime switch

AquGrim now opens supported game SWFs through Ruffle only. Existing installations migrate to Ruffle and low game quality once; later quality choices persist. The shared toolbar, AS3 bridge, same-origin assets and socket relay are retained. Packet steering also rewrites the server list used to prepare Ruffle’s socket mappings.

Validation: 1,480 regression tests and plugin smoke checks pass. An isolated Electron launch reached the game login screen with a ready bridge, 11 toolbar controls and no Flash object/embed elements. A fresh authenticated session was not repeated after integration.
