import { PortfolioTable } from "../components/PortfolioTable";
import { ScreenPanel } from "../components/ScreenPanel";

export function Home() {
  return (
    <div className="container">
      <ScreenPanel />
      <PortfolioTable />
    </div>
  );
}
