import React from 'react'

export const Layout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="min-h-screen bg-background text-slate-200">
      <nav className="border-b border-slate-800 p-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <span className="text-xl font-bold tracking-tight">DEADWORKS</span>
          <div className="space-x-6 text-sm font-medium">
            <a href="#" className="hover:text-primary transition-colors">Dashboard</a>
            <a href="#" className="hover:text-primary transition-colors">Settings</a>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto py-8">
        {children}
      </main>
    </div>
  )
}
