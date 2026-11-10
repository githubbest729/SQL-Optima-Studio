# SQL-Optima Studio — Non-Technical Operator & Client Guide

Welcome to **SQL-Optima Studio**. This application is an industrial health monitor, performance optimizer, and data viewer built for district cooling, utilities, and SCADA facilities.

You do not need programming or database knowledge to use this software. This guide explains each screen in plain language.

---

## 1. Safety & Read-Only Guarantee
* **No Outage Risk**: The software connects in strict **Read-Only Mode**.
* **Zero Machine Disruption**: Nothing typed or clicked here can alter chiller setpoints, stop pumps, or delete records.

---

## 2. Navigation Overview

### 📊 Engineering Dashboard
* **Purpose**: Plant high-level overview.
* **Historian Health**: A 0–100 score indicating overall database responsiveness (80+ is normal).
* **Critical Bottlenecks**: Highlights slow or unindexed data requests needing tuning.
* **Top Latency**: Shows which reports consume the most processing time.

### ⏱️ SQL Query Profiler
* **Purpose**: An automated "report doctor" that checks why a data pull is running slowly.
* **How to use**:
  1. Pick a template from the right sidebar (e.g., *Chiller Plant kW/TR & Flow Trend*).
  2. Click **Profile Query**.
  3. Review the **Query Score** and plain-English recommendations.

### 🗄️ Historian Explorer
* **Purpose**: A live catalog of industrial plant sensors.
* **What you see**:
  * **Tag Name**: Sensor ID (e.g., `CH01.SupplyTemperature` = Chiller 1 water sent to the network).
  * **Latest Value**: The live reading updating from the plant.
  * **OPC Quality**: Shows `Good (192)` when communication is healthy.

### 📈 Trend Analyzer
* **Purpose**: A live chart showing temperature and power changes over time.
* **What you see**:
  * The blue wave shows real-time fluctuations.
  * **Export CSV**: Downloads the recorded points for spreadsheets or reporting.

### 🚨 Alarm & Event Analytics
* **Purpose**: Helps plant managers spot problematic equipment.
* **Key Terms**:
  * **Alarm Flood**: Indicates whether operators are being overwhelmed by too many alerts at once.
  * **Bad Actors**: Identifies erratic instruments that chatter or trigger repetitive false trips.

### 🛠️ Script Workbench
* **Purpose**: A preview of automated calculations (ETL jobs, chiller sequencing logic).
* **How to use**: Click **Static Lint** to verify script syntax safety.

### ⚙️ System Diagnostics & Settings
* **Purpose**: Connection link to the industrial edge gateway and theme selection.
* **How to use**: Enter your access token (`agac-scada-token-2026`) and click **Connect to Gateway** to start the live telemetry feed.
