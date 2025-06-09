/*
README: 

Este é um template Next.js (App Router) em TypeScript para um dashboard de horas por projeto e gráfico de Gantt.

Dependências:
  npm install recharts react-google-charts

Env:
  NEXT_PUBLIC_REPORT_URL=https://seu-bucket.com/report.json

Deploy:
  Vercel (push do projeto basta; configure a variável acima no dashboard da Vercel)

Estrutura:
  app/
    page.tsx       # Dashboard (Client Component)
*/

'use client';
import { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Chart } from 'react-google-charts';

// Tipagens
interface HoursByProject {
  [project: string]: { [user: string]: number };
}
interface PRTimelineItem {
  project: string;
  number: number;
  start: string;
  end: string;
}
interface Report {
  hoursByProject: HoursByProject;
  prTimeline: PRTimelineItem[];
}

export default function Page() {
  const [data, setData] = useState<Report>({ hoursByProject: {}, prTimeline: [] });
  const [loading, setLoading] = useState(true);
  const url = process.env.NEXT_PUBLIC_REPORT_URL!;

  useEffect(() => {
    async function fetchReport() {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: Report = await res.json();
        setData(json);
      } catch (err) {
        console.error('Erro ao buscar relatório:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchReport();
  }, [url]);

  if (loading) return <p>Carregando dashboard...</p>;

  // Preparar dados para Recharts
  const barData = Object.entries(data.hoursByProject).map(
    ([project, users]) => ({ project, ...users })
  );
  const users = Array.from(
    new Set(
      barData.flatMap(item => Object.keys(item)).filter(k => k !== 'project')
    )
  );

  // Preparar dados para Gantt (Google Charts)
  const ganttRows: (string | Date)[][] = [
    ['Task ID', 'Task Name', 'Start Date', 'End Date'],
    ...data.prTimeline.map(pr => [
      `${pr.project}_${pr.number}`,
      `${pr.project}: #${pr.number}`,
      new Date(pr.start),
      new Date(pr.end),
    ]),
  ];

  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Dashboard de Horas e Gantt</h1>

      <section style={{ height: 400, marginTop: '1.5rem' }}>
        <h2>Horas por Projeto / Usuário</h2>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={barData}
            margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
          >
            <XAxis dataKey="project" />
            <YAxis />
            <Tooltip />
            <Legend />
            {users.map(user => (
              <Bar key={user} dataKey={user} stackId="a" />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Gantt de PRs</h2>
        <Chart
          width="100%"
          height="400px"
          chartType="Gantt"
          loader={<div>Carregando Gantt...</div>}
          data={ganttRows}
          options={{
            gantt: { trackHeight: 30 }
          }}
        />
      </section>
    </main>
  );
}
