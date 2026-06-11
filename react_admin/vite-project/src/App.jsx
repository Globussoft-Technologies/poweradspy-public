import "./App.css";
import { RouterProvider } from "react-router-dom";
import { routes } from "./routes/index";
import AdminProvider from "./Context/Provider";

function App() {
  return (
    <>
      <AdminProvider>
        <RouterProvider router={routes} />{" "}
      </AdminProvider>
    </>
  );
}

export default App;
