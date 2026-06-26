import { Outlet } from "react-router-dom";

export function MarketingLayout() {
  return (
    <div className="marketing-module">
      <Outlet />
    </div>
  );
}
