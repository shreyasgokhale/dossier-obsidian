"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { saveTracking } from "./tracking-actions";
export function TrackingFields({ id, initial }: { id: string; initial: { applicationDate: string; followUpDate: string; nextAction: string; company: string; role: string; postingUrl: string; location: string; deadline: string } }) {
  const [values, setValues] = useState(initial), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  return <details className="mx-10 my-3 rounded-card border border-line p-3 text-sm"><summary className="cursor-pointer">Application details and follow-up</summary><div className="mt-3 grid grid-cols-2 gap-3">{Object.entries(values).map(([key, value]) => <Input key={key} label={key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())} type={key.endsWith("Date") || key === "deadline" ? "date" : "text"} value={value} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />)}</div><Button className="mt-3" disabled={busy} onClick={async () => { setBusy(true); const result = await saveTracking({ id, values }); setMessage(result.ok ? "Application details saved." : result.error); setBusy(false); }}>Save application details</Button>{message && <p role="status">{message}</p>}</details>;
}
