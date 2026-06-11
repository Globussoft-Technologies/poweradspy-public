import React, { useRef, useState } from 'react';
import AdminContext from './Context';

const AdminProvider = ({ children }) => {
 const [searchdataFilterTable,setsearchdataFilterTable] = useState(3)
 const [sidebarOpen,setsidebarOpen] = useState(true)
  return (
    <AdminContext.Provider
      value={{
        searchdataFilterTable,
        setsearchdataFilterTable,
        sidebarOpen,setsidebarOpen
      }}>
      {children}
    </AdminContext.Provider>
  );
};

export default AdminProvider;
