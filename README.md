# 🚦 The Prototype: Event-Driven Congestion Intelligence System
### AI-Powered Traffic Forecasting, Diversion Planning, & Manpower Allocation for Bengaluru
---

## 📋 Table of Contents
1. [🎯 Project Overview](#-project-overview)
2. [⚠️ Problem Statement & Context](#️-problem-statement--context)
3. [🏗️ Solution Architecture](#️-solution-architecture)
4. [📊 Dataset & Spatial-Temporal Insights](#-dataset--spatial-temporal-insights)
5. [🔬 Algorithms & Mathematical Formulation](#-algorithms--mathematical-formulation)
6. [⚙️ Technical Stack & Architectural Decisions](#️-technical-stack--architectural-decisions)
7. [📂 Project Structure](#-project-structure)
8. [🚀 How to Run & Verify](#-how-to-run--verify)
9. [🖥️ Detailed Feature Walkthrough](#️-detailed-feature-walkthrough)
10. [📈 Scalability & Future Integration Roadmap](#-scalability--future-integration-roadmap)

---

## 🎯 Project Overview

**The Prototype** is an operational intelligence system designed to mitigate traffic congestion in Bengaluru caused by both planned and unplanned events. By ingesting historical incident data from the Bengaluru Traffic Police (BTP) **Astram platform** (covering 8,173 real-world events), The Prototype equips dispatchers and traffic planners with three key tools:

1. **Impact Forecasting:** A multi-factor **Bengaluru Severity Score (BSS)** that quantifies event disruption before it spreads.
2. **Dynamic Diversions:** An interactive network analysis tool mapping alternate routes across corridors when junctions are blocked.
3. **Manpower & Equipment Resource Allocation:** A formula-driven engine recommending staffing levels, shift schedules, and barricade manifests.

Built using **vanilla web technologies**, The Prototype operates with **zero external dependencies, databases, or frameworks** on the client side, allowing it to load instantly and run locally on any terminal, mobile device, or control room console.

---

## ⚠️ Problem Statement & Context

### The Challenge: Event-Driven Congestion
Bengaluru's road network is highly vulnerable to localized traffic breakdown. Disruptions range from planned events (VIP movements, festivals, protests) to unpredictable incidents (vehicle breakdowns, accidents, water logging, tree falls).

Under current operations, response efforts suffer from:
* **Gut-Feel Deployment:** Manpower and equipment allocations are based on individual operator experience rather than empirical event characteristics.
* **Delayed Diversions:** Standard alternate route plans are manually computed and coordinated, taking 15 to 20 minutes to communicate to motorists and field officers.
* **No Closed-Loop Learning:** Historical resolution times and corridor vulnerability patterns are rarely fed back to adapt future deployment models.

### Key Data Insights (8,173 Historical Events)
Analysis of the Astram dataset reveals:
* **94.3% Unplanned:** Only 5.7% of traffic-disrupting incidents are planned in advance, highlighting the need for rapid real-time response generation.
* **Corridor Clumping:** Mysore Road, Bellary Road, and Tumkur Road exhibit high incident density, acting as primary points of failure.
* **Temporal Spikes:** Event occurrence clusters around peak commute times: **8:00 AM – 11:00 AM** and **5:00 PM – 8:00 PM**.
* **High-Impact Causes:** While vehicle breakdowns account for the largest sheer volume of reports, protests and processions result in the highest rate of full road closures.

---

## 🏗️ Solution Architecture

The Prototype uses a two-stage data pipeline to clean and index spatial-temporal data, which is then made accessible through a fast frontend portal:

```
┌─────────────────────────────────────────────────────────────┐
│                    The Prototype Architecture                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────┐  ┌──────────────────┐  ┌───────────┐ │
│   │  📊 Barricade   │  │  🔀 Diversion    │  │ 👮 Man-   │ │
│   │  (BSS Model)    │  │  Dictionary      │  │ power     │ │
│   │                 │  │  (Graph Engine)  │  │ Allocator │ │
│   └────────┬────────┘  └────────┬─────────┘  └─────┬─────┘ │
│            │                    │                   │       │
│            ▼                    ▼                   ▼       │
│   ┌─────────────────────────────────────────────────────┐   │
│   │         Processed Event Intelligence Layer          │   │
│   │      (5.9MB JSON containing 20 curated sections)    │   │
│   └─────────────────────┬───────────────────────────────┘   │
│                         ▲ (JSON Fallback: Direct Browser Parser)   │
│   ┌─────────────────────┴───────────────────────────────┐   │
│   │             Raw Data: Astram CSV Dataset             │   │
│   │     (8,173 rows mapping Nov 2023 - Apr 2024 events) │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

1. **The Preprocessing Pipeline (`process-data.py`):** Written in pure Python, it parses the raw CSV, performs timezone normalization, filters out outlier durations using the Interquartile Range (IQR), fits event cause weights based on actual closure rates, creates a coordinate-linked junction diversion graph, and exports the final metrics into a single structured JSON.
2. **The Client Interface (`index.html` & `app.js`):** A Single Page Application (SPA) that loads the preprocessed JSON to render interactive charts (via Chart.js) and maps (via Leaflet.js). If the JSON file is missing or fails to load, **an in-browser CSV parser automatically reconstructs the data structures directly from the raw CSV**, ensuring zero downtime.

---

## 📊 Dataset & Spatial-Temporal Insights

The historical dataset profiles Bengaluru's traffic disruptions across the following dimensions:

### Event Cause Distribution & Operational Metrics
| Incident Cause | Volumetric Share | Avg. Resolution | Road Closure Rate | BSS Relative Weight |
| :--- | :---: | :---: | :---: | :---: |
| 🚗 **Vehicle Breakdown** | Very High | ~1.2 hrs | Low | Low (0.28) |
| 🚨 **Accident** | Medium | ~2.1 hrs | Medium | Medium (0.52) |
| ✊ **Protest** | Low | ~4.5 hrs | Very High | High (0.95) |
| 🎉 **Public Event** | Low | ~6.2 hrs | High | High (1.00) |
| 🕳️ **Water Logging** | Seasonal | ~3.8 hrs | Medium | Medium-High (0.64) |
| 🏗️ **Construction** | High | Extended | Low-Medium | Medium (0.48) |

### Temporal Event Clustering
Analysis indicates that traffic load peaks on weekdays between 08:00–11:00 and 17:00–20:00. Preprocessing computes an exponential moving average (smoothing alpha = 0.35) of hourly and weekly occurrences to model baselines and forecast congestion risk for upcoming shifts.

---

## 🔬 Algorithms & Mathematical Formulation

The recommendation engines in The Prototype are governed by three primary mathematical pillars:

### 1. Bengaluru Severity Score (BSS)
The BSS is a normalized score bounded by `[0, 1]`. It represents the overall traffic threat level and determines physical barricading requirements:

$$\text{BSS} = 0.20 \cdot W_{\text{cause}} + 0.12 \cdot W_{\text{type}} + 0.22 \cdot W_{\text{closure}} + 0.14 \cdot W_{\text{priority}} + 0.14 \cdot I_{\text{corridor}} + 0.10 \cdot M_{\text{time}} + 0.08 \cdot F_{\text{duration}}$$

* **$W_{\text{cause}}$ (Cause Weight):** Derived directly from the historical data pipeline based on how often a cause results in closures:
  $$\text{Score}(c) = 0.50 \cdot \text{ClosureRate} + 0.30 \cdot \text{HighPriorityRate} + 0.20 \cdot \text{OccurenceFraction}$$
* **$W_{\text{type}}$ (Event Type):** $1.0$ for pre-planned events (high public gathering chance), $0.65$ for unplanned.
* **$W_{\text{closure}}$ (Road Closure Requirement):** $1.0$ if the event requires blocking traffic lanes, $0.2$ otherwise.
* **$W_{\text{priority}}$ (Police Priority Rating):** 1.0 if marked High Priority, 0.35 otherwise.
* **I_corridor (Corridor Importance Index):** Logarithmic scale based on incident density relative to the busiest corridor:

  `I_corridor = min(N_corridor_events / N_max_corridor_events, 1.0)`

* **M_time (Time Multiplier):** Bounded between 0.45 and 1.0 based on peak hour overlaps (IST).

  - **Peak** (08:00–11:00, 17:00–20:00): **1.0**
  - **Shoulder** (07:00–12:00, 16:00–21:00): **0.8**
  - **Off-peak** (remaining hours): **0.45**
* **$F_{\text{duration}}$ (Duration Factor):** Linear scaling capped at 24 hours: $\min\left(\frac{\text{Duration in Hours}}{24}, 1.0\right)$

#### Barricading Recommendations based on BSS
* **BSS $\ge 0.80$ (Critical): Full Closure.** Jersey barriers, complete road blockages, multi-point barricading, warning blinkers.
* **BSS $0.60 - 0.79$ (High): Partial Closure.** Movable metal barricades, lane restrictions, safety cones.
* **BSS $0.40 - 0.59$ (Medium): Warning Zone.** Signboards, hazard blinkers, traffic marshals.
* **BSS $< 0.40$ (Low): Monitor Only.** Regular patrol vehicle surveillance, walkie-talkie monitoring.

### 2. Manpower Deployment Formula
Required personnel counts scale dynamically with the severity score and incident parameters:

$$\text{Officers Per Shift} = \text{BaseCount}(c) \cdot (1.0 + 2.5 \cdot \text{BSS}) \cdot F_{\text{dur}} \cdot F_{\text{closure}}$$

Where:
* **$\text{BaseCount}(c)$:** Standard baseline staffing (e.g., Protest = 12, VIP Movement = 6, Breakdown = 2).
* **$F_{\text{dur}}$ (Duration Scaling):** $1.5$ if duration $> 12$ hours, $1.2$ if $> 6$ hours, $1.0$ otherwise.
* **$F_{\text{closure}}$ (Closure Penalty):** $1.4$ if a road closure is active, $1.0$ otherwise.
* **Shift Rotation:** Total shifts = $\lceil\frac{\text{Duration in Hours}}{8}\rceil$ (based on standard 8-hour rotations).

#### Tactical Role Distribution
Once the total recommended officers are calculated, they are assigned to specific roles:
* **Traffic Control (40%):** Directing vehicle flow around bottlenecks.
* **Crowd Management (25%):** Pedestrian safety and perimeter policing.
* **Emergency Response (20%):** Ready to respond to additional breakdowns or medical needs.
* **Surveillance (15%):** Monitoring traffic cameras and drone feeds.

### 3. Diversion Graph Construction
The pipeline compiles a Dijkstra-ready routing graph representing junctions and corridors:
* **Nodes:** Mapped junctions containing geolocations, event counts, and vulnerability ratings.
* **Edges:** Road connections established via spatial proximity checks:
  * Same-Corridor Threshold: $\le 3.5\text{ km}$
  * Cross-Corridor Threshold: $\le 2.0\text{ km}$
* **Edge Weight Formulation:** Incorporates both haversine distance and junction vulnerability to penalize route options that pass through historically congested zones:

$$
\text{Edge Weight} = \text{Distance (km)} \cdot \left(1 + \frac{V_{\text{junction A}} + V_{\text{junction B}}}{2}\right)
$$

Where $V_{\text{junction}}$ is the junction's vulnerability score (derived from closure rates and priority incident frequency).
---

## ⚙️ Technical Stack & Architectural Decisions

The Prototype uses a highly optimized, zero-compilation build architecture designed for reliability in low-bandwidth municipal IT environments:

| Component | Technical Implementation | Rationale |
| :--- | :--- | :--- |
| **Frontend Architecture** | Semantic HTML5, CSS3, Vanilla ES6+ JS | Zero frameworks, zero compilation, runs on any device out-of-the-box. |
| **Mapping Engine** | Leaflet.js (1.9.4) + CartoDB Dark Tiles | Lightweight, high-performance mapping; doesn't require API keys or billing setup. |
| **Visual Analytics** | Chart.js (4.4.0) + Datalabels Plugin | Hardware-accelerated canvas chart rendering with clean layout overlays. |
| **Data Processing** | Python 3 (stdlib: `csv`, `concurrent.futures`, `heapq`) | Fast concurrent CSV parsing; generates self-contained JSON data assets. |

---

## 📂 Project Structure

```
Prototype-Submission/
├── index.html                        # Main single-page application dashboard interface
├── styles.css                        # Design system: variables, glassmorphism, responsive grid layout
├── app.js                            # Core frontend logic: metrics, simulator, diversion router, mapping
├── process-data.py                   # Python data-engineering pipeline (CSV → JSON compiler)
├── processed-data.json               # Compiled static database containing processed graph data
├── astram-event-data.csv  # Raw dataset containing 8,173 BTP event records
└── README.md                         # This file
```

---

## 🚀 How to Run & Verify

### Option A: Quick Start (Using Preprocessed Data)
Since the repository contains the pre-compiled `processed-data.json` file, you can start the application immediately by serving it via a local HTTP server.

> [!IMPORTANT]
> Running the application directly from the filesystem (`file://` protocol) will trigger browser CORS security exceptions when loading the JSON dataset. Always run the application via a local HTTP server.

#### 1. Start a local server:
* **Using Python (Recommended):**
  ```bash
  python3 -m http.server 8080
  ```
* **Using Node.js:**
  ```bash
  npx -y serve -p 8080
  ```
* **Using PHP:**
  ```bash
  php -S localhost:8080
  ```

#### 2. Access the Application:
Open your web browser and navigate to: `http://localhost:8080`

---

### Option B: Preprocess Raw Data (Compile JSON)
If the raw CSV data has changed, or you want to rebuild the static JSON file, run the Python preprocessing script:

```bash
python3 process-data.py
```

**Expected Output:**
```text
Reading CSV: astram-event-data.csv
Processing …
  → 8155 valid events loaded
  → Computing BSS scores …
  → Computing hotspots …
  → Building diversion graph …
Writing JSON: processed-data.json
  → Total events:        8155
  → Corridors:           22
  → Junctions:           294
  → Zones:               10
  → Hotspots:            30
  → Graph nodes/edges:   294/3519
  → Cause categories:    13
  → Repeat offenders:    15
Done ✓
```

---

### Option C: In-Browser Fallback Verification
To verify the system's client-side fallback mode:
1. Temporarily rename or move `processed-data.json`.
2. Reload `http://localhost:8080`.
3. The loading screen will display `JSON not found, parsing CSV...`.
4. The frontend will parse the raw CSV in-browser, rebuild the metrics, and run normally.

---

## 🖥️ Detailed Feature Walkthrough

### 1. Dashboard Overview
* **KPI Metrics & Clock:** Tracks total records, road closures, active issues, and monitored corridors, alongside a Live IST Clock.
* **Weekly Congestion Heatmap:** A custom 7x24 grid visualizing historical incident density by day and hour.
* **Enhanced Spatial Maps:** Three interactive view modes (Heatmap, Marker Clusters, or Both) over Leaflet with a dynamic Map Legend.
* **Time-Slice Simulation:** Dispatchers can choose different date and time slices to view how past incidents accumulated during specific morning or evening rush hours.

### 2. Impact Predictor & Simulator
* **Interactive Modeler:** Allows operators to input proposed variables (e.g., "Protest", "VIP Movement") along a corridor to predict the traffic footprint.
* **BSS Factor Radar Chart:** Visualizes all 7 BSS factor weights simultaneously, instantly showing what drives the severity score up.
* **Scenario Simulator:** A training tool that randomly generates emergency scenarios, calculates the resulting BSS, and displays tactical recommendations.
* **Resource Requisition Manifest:** Outputs the required count of officers, role splits, shifts, and equipment lists (e.g., cones, signboards, Jersey barriers) based on the event BSS.

### 3. Diversion Planner
* **Blocked Corridor Selection:** Allows operators to select any corridor to simulate a traffic block.
* **Real-Road Routing:** Follows actual OpenStreetMap (OSRM) road geometries for diversion mapping rather than straight lines.
* **Alternate Route Mapping:** Computes connecting corridors, calculates detour distances, and estimates travel times.
* **Capacity Scoring:** Colors and ranks alternate routes based on their historical stability and capacity.

### 4. Barricading Plan
* **Zone-Wide Manifests:** Aggregates BSS calculations to estimate total barricading equipment requirements for selected traffic sectors.
* **BSS Distribution Charts:** Visualizes current incident counts grouped by severity categories (Critical, High, Medium, Low).

### 5. Manpower Allocation
* **Staffing Calculator:** Helps operators manually calculate recommended officer counts, shift breakdowns, and tactical roles.
* **Vulnerability Grids:** Ranks traffic zones by incident volume to guide long-term deployment strategies.

### 6. Data Explorer
* **Historical Database:** Features a search bar and filter controls to quickly explore the 8,173 raw incident records.
* **Pagination:** Supports smooth, client-side pagination (50 rows per page) to load and filter the dataset in milliseconds.

---

## 📈 Scalability & Future Integration Roadmap

The Prototype is designed to scale from a static prototype to an active, city-wide operational tool:

1. **Phase 1 (Current Prototype):** Standalone browser engine using static dataset compile scripts and dual-load mechanisms.
2. **Phase 2 (Live API Integration):** Integrating live Astram feeds and Google Maps Traffic APIs to continuously adjust junction weights.
3. **Phase 3 (Machine Learning):** Transitioning BSS forecasting from static formulas to a gradient-boosted regression model trained on historical clearance rates and weather telemetry.
4. **Phase 4 (Multi-City Rollout):** The system's routing engine is city-agnostic. Municipalities can import their own street networks and incident CSVs to generate local diversion dictionaries.

---

### Built for the Flipkart Grid 6.0 Engineering Challenge
*Solving Event-Driven Congestion, One Algorithm at a Time.*
