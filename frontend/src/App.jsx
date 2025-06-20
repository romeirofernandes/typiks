import { BrowserRouter, Route, Routes } from "react-router-dom";
import Landing from "./pages/Landing";
import SignUp from "./pages/SignUp";
import SignIn from "./pages/SignIn";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/signin" element={<SignIn />} />
      </Routes>
    </BrowserRouter>
  );
}
