/* =====================================================================
   SQL-Optima Studio — Interactive User Guide & Walkthrough Modal
   Designed for Non-Technical Operators & AGAC Stakeholders
   ===================================================================== */
(function () {
  'use strict';

  var GUIDE_PAGES = [
    {
      tab: 'dashboard',
      title: '1. Engineering Dashboard',
      subtitle: 'The Plant Health Overview',
      badge: 'HEALTH MONITOR',
      summary: 'Gives managers and operators a single-screen bird\'s-eye view of plant health, data collection speed, and critical bottlenecks.',
      steps: [
        'Check <strong>Historian Health (0–100)</strong>: A green score above 80 means data collection is smooth.',
        'Use the <strong>Sector</strong> filter to view your specific industry (e.g. District Cooling).',
        'Review <strong>Top Latency Queries</strong> to see which data reports are taking the longest to generate.'
      ],
      tip: 'Safe for everyone: This tab only displays historical summaries. You cannot break anything by clicking here.'
    },
    {
      tab: 'profiler',
      title: '2. SQL Query Profiler',
      subtitle: 'The Report Card & Performance Tuner',
      badge: 'REPORT TUNING',
      summary: 'Diagnoses why plant reports take minutes to generate and provides plain recommendations to speed them up.',
      steps: [
        'Click any pre-built example under <strong>Templates</strong> on the right.',
        'Click the blue <strong>Profile Query</strong> button.',
        'Inspect the <strong>Query Score</strong> and read the <strong>Advisor Recommendations</strong> for simple fix steps.'
      ],
      tip: 'The gateway uses strict read-only safety locks. It will automatically reject any command that attempts to change data.'
    },
    {
      tab: 'historian',
      title: '3. Historian Explorer',
      subtitle: 'The Live Equipment & Sensor Ledger',
      badge: 'LIVE SENSORS',
      summary: 'A real-time search table showing every sensor, chiller temperature, pressure sensor, and flow rate across the facility.',
      steps: [
        'Type any equipment name (like <em>Chiller</em>, <em>Flow</em>, or <em>Pressure</em>) into the search box.',
        'Look at <strong>Latest Value</strong> to see current plant readings updated live every second.',
        'Check <strong>OPC Quality</strong>: "Good (192)" confirms the physical field sensor is communicating properly.'
      ],
      tip: 'Values flash briefly whenever new numbers arrive from the plant floor.'
    },
    {
      tab: 'trends',
      title: '4. Trend Analyzer',
      subtitle: 'The Equipment Heartbeat Monitor',
      badge: 'LIVE WAVEFORM',
      summary: 'Draws a continuous live line chart showing chiller supply temperatures and load variations in real time.',
      steps: [
        'Watch the <strong>Blue Trend Line</strong> draw itself live across the canvas.',
        'Read the large <strong>Current Value</strong> card for instant temperature confirmation (e.g. 5.8 °C).',
        'Click <strong>Export CSV</strong> in the upper right to download raw data directly into an Excel spreadsheet.'
      ],
      tip: 'The chart holds a rolling 60-second buffer of high-precision readings.'
    },
    {
      tab: 'alarms',
      title: '5. Alarm & Event Analytics',
      subtitle: 'The Early Warning System',
      badge: 'ALARM SAFETY',
      summary: 'Filters nuisance plant chatter and flags bad-actor equipment before costly downtime occurs.',
      steps: [
        'Check <strong>Alarm Flood Status</strong>: "NORMAL" means operators are not being overwhelmed.',
        'Look at <strong>Bad Actors (24h)</strong> to spot repeating equipment trips.',
        'Review the <strong>Sequence of Events (SOE)</strong> table to see exact trip timestamps.'
      ],
      tip: 'Compliant with EEMUA 191 industrial alarm management standards.'
    },
    {
      tab: 'workbench',
      title: '6. Script Workbench',
      subtitle: 'Safe Calculation & Automation Sandbox',
      badge: 'CALCULATIONS',
      summary: 'Allows engineers to test report formulas and plant logic without any risk of affecting live machines.',
      steps: [
        'Click a script on the left (Python, C#, or Structured Text).',
        'Click <strong>Static Lint</strong> to verify syntax safety.',
        'Click <strong>Test Run (Sandbox)</strong> to simulate execution safely.'
      ],
      tip: 'All runs are sandboxed and simulated client-side.'
    },
    {
      tab: 'settings',
      title: '7. Settings & Diagnostics',
      subtitle: 'Control Room Preferences & Gateway Link',
      badge: 'SETTINGS',
      summary: 'Manage control room display themes and verify your secure link to the plant edge gateway.',
      steps: [
        'Switch between <strong>Control Room Dark</strong>, <strong>Engineer Slate</strong>, or <strong>High-Viz Amber</strong>.',
        'Confirm the green <strong>LIVE OT LINK</strong> indicator is active in the top navigation bar.',
        'Click <strong>Test Health (HTTP)</strong> to test gateway round-trip responsiveness.'
      ],
      tip: 'Default access token is: <code>agac-scada-token-2026</code>.'
    }
  ];

  function openGuideModal(defaultTab) {
    var existing = document.querySelector('#guideModalMount');
    if (existing) existing.remove();

    var currentIdx = 0;
    if (defaultTab) {
      var foundIdx = GUIDE_PAGES.findIndex(function (p) { return p.tab === defaultTab; });
      if (foundIdx !== -1) currentIdx = foundIdx;
    }

    var mount = document.createElement('div');
    mount.id = 'guideModalMount';
    mount.style.position = 'fixed';
    mount.style.inset = '0';
    mount.style.background = 'rgba(2, 6, 23, 0.75)';
    mount.style.backdropFilter = 'blur(6px)';
    mount.style.display = 'flex';
    mount.style.alignItems = 'center';
    mount.style.justifyContent = 'center';
    mount.style.zIndex = '9999';
    mount.style.padding = '16px';

    function renderContent() {
      var p = GUIDE_PAGES[currentIdx];
      mount.innerHTML =
        '<div style="background: var(--bg-card, #0f172a); border: 1px solid var(--border, #1e293b); border-radius: 12px; width: 100%; max-width: 680px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); overflow: hidden; font-family: var(--font-sans, system-ui); display: flex; flex-direction: column;">' +
          '<div style="padding: 16px 20px; border-bottom: 1px solid var(--border, #1e293b); display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.02);">' +
            '<div style="display: flex; align-items: center; gap: 10px;">' +
              '<span class="badge sev-info" style="font-size: 0.75rem;">' + p.badge + '</span>' +
              '<strong style="font-size: 1rem; color: var(--text, #f8fafc);">' + p.title + '</strong>' +
            '</div>' +
            '<button id="btnCloseGuide" style="background: transparent; border: none; color: var(--text-dim, #94a3b8); cursor: pointer; font-size: 1.25rem; line-height: 1; padding: 4px;">&times;</button>' +
          '</div>' +

          '<div style="padding: 20px; color: var(--text, #f8fafc); max-height: 70vh; overflow-y: auto;">' +
            '<h3 style="margin: 0 0 4px; font-size: 1.15rem; color: var(--cyan, #38bdf8);">' + p.subtitle + '</h3>' +
            '<p style="margin: 0 0 16px; font-size: 0.9rem; color: var(--text-dim, #94a3b8); line-height: 1.5;">' + p.summary + '</p>' +

            '<div style="background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 8px; padding: 14px; margin-bottom: 16px;">' +
              '<strong style="display: block; font-size: 0.85rem; margin-bottom: 8px; color: var(--cyan, #38bdf8);">How to use this screen (Step-by-Step):</strong>' +
              '<ol style="margin: 0; padding-left: 20px; font-size: 0.85rem; line-height: 1.7;">' +
                p.steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') +
              '</ol>' +
            '</div>' +

            '<div style="background: rgba(34, 197, 94, 0.05); border-left: 3px solid var(--ok, #22c55e); padding: 10px 14px; border-radius: 4px; font-size: 0.8rem; color: var(--text-dim, #94a3b8);">' +
              '💡 <strong>Non-Technical Tip:</strong> ' + p.tip +
            '</div>' +
          '</div>' +

          '<div style="padding: 12px 20px; border-top: 1px solid var(--border, #1e293b); display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.02);">' +
            '<div style="font-size: 0.8rem; color: var(--text-dim, #94a3b8);">' +
              'Page ' + (currentIdx + 1) + ' of ' + GUIDE_PAGES.length +
            '</div>' +
            '<div style="display: flex; gap: 8px;">' +
              '<button id="btnPrevGuide" class="btn" style="padding: 6px 14px; font-size: 0.8rem;" ' + (currentIdx === 0 ? 'disabled' : '') + '>Previous</button>' +
              '<button id="btnNextGuide" class="btn btn-primary" style="padding: 6px 14px; font-size: 0.8rem;">' + (currentIdx === GUIDE_PAGES.length - 1 ? 'Finish Tour' : 'Next') + '</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      mount.querySelector('#btnCloseGuide').onclick = function () { mount.remove(); };
      var prevBtn = mount.querySelector('#btnPrevGuide');
      if (prevBtn) {
        prevBtn.onclick = function () {
          if (currentIdx > 0) { currentIdx--; renderContent(); }
        };
      }
      var nextBtn = mount.querySelector('#btnNextGuide');
      if (nextBtn) {
        nextBtn.onclick = function () {
          if (currentIdx < GUIDE_PAGES.length - 1) {
            currentIdx++;
            renderContent();
          } else {
            mount.remove();
          }
        };
      }
    }

    renderContent();
    document.body.appendChild(mount);
  }

  window.openGuideModal = openGuideModal;
})();