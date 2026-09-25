import { HashRouter, Routes, Route } from "react-router-dom";
import { GameProvider } from "./context/GameContext";
import Lobby from "./pages/Lobby";
import GameIng from "./pages/GameIng";
import GameOver from "./pages/GameOver";

export default function App() {
  return (
    <GameProvider>
      <HashRouter>
        <div className="min-h-screen bg-black text-white font-sans">
          <Routes>
            <Route path="/" element={<Lobby />} />
            <Route path="/game/ing" element={<GameIng />} />
            <Route path="/game-over" element={<GameOver />} />
          </Routes>
        </div>
      </HashRouter>
    </GameProvider>
  );
}
