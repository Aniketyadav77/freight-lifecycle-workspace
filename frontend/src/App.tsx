import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { AnalyticsView } from "./features/analytics/AnalyticsView";
import { ActiveShipments } from "./features/execute/ActiveShipments";
import { LoadDetail } from "./features/load/LoadDetail";
import { SettlementView } from "./features/settle/SettlementView";
import { ProcurementBoard } from "./features/procure/ProcurementBoard";
import { TrackingView } from "./features/track/TrackingView";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* One persistent shell holds the socket and nav; modules nest inside. */}
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/procure" replace />} />
          <Route path="procure" element={<ProcurementBoard />} />
          <Route path="active" element={<ActiveShipments />} />
          <Route path="track" element={<TrackingView />} />
          <Route path="settle" element={<SettlementView />} />
          <Route path="analytics" element={<AnalyticsView />} />
          {/* Every module's list links here. Nested inside the shell, so the
              nav and the live socket survive the navigation. */}
          <Route path="loads/:id" element={<LoadDetail />} />
          <Route path="*" element={<Navigate to="/procure" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
