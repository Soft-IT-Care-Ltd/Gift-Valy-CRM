"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { toCsv, downloadCsv, csvDateStamp } from "@/lib/csv";
import {
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  LOST_REASON_LABELS,
} from "@/lib/lead-constants";
import type { LeadReport, LeadConversionRow } from "@/lib/reports";

export function LeadReportClient({
  report,
  seOptions,
  filters,
}: {
  report: LeadReport;
  seOptions: { id: number; name: string }[];
  filters: { from: string; to: string; seId: string; source: string; campaign: string };
}) {
  const router = useRouter();
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [seId, setSeId] = useState(filters.seId);
  const [source, setSource] = useState(filters.source);
  const [campaign, setCampaign] = useState(filters.campaign);

  function apply() {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (seId !== "ALL") p.set("seId", seId);
    if (source !== "ALL") p.set("source", source);
    if (campaign.trim()) p.set("campaign", campaign.trim());
    router.push(`/leads/report${p.toString() ? `?${p}` : ""}`);
  }
  function reset() {
    setFrom("");
    setTo("");
    setSeId("ALL");
    setSource("ALL");
    setCampaign("");
    router.push("/leads/report");
  }

  const rangeLabel = `${formatDate(report.range.from)} → ${formatDate(report.range.to)}`;

  function exportGroup(name: string, rows: LeadConversionRow[], labelHead: string) {
    const headers = [labelHead, "Leads", "Converted", "Conversion %"];
    const body = rows.map((r) => [r.label, r.total, r.converted, r.conversionPct]);
    downloadCsv(`leads-by-${name}-${csvDateStamp()}.csv`, toCsv(headers, body));
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Lead report</h1>
        <p className="text-sm text-muted-foreground">
          R2 — leads by SE, source, campaign and date, with conversion % and the
          lost-reason breakdown.
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="grid gap-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          {seOptions.length > 0 && (
            <div className="grid gap-1">
              <Label className="text-xs">SE</Label>
              <Select value={seId} onValueChange={setSeId}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Everyone</SelectItem>
                  {seOptions.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1">
            <Label className="text-xs">Source</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All sources</SelectItem>
                {LEAD_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Campaign</Label>
            <Input value={campaign} onChange={(e) => setCampaign(e.target.value)} className="w-40" placeholder="exact" />
          </div>
          <Button onClick={apply}>Apply</Button>
          <Button variant="outline" onClick={reset}>This month</Button>
          <span className="ml-auto self-center text-sm text-muted-foreground">
            Showing {rangeLabel}
          </span>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Total leads" value={String(report.totalLeads)} sub={report.bulkCount > 0 ? `+${report.bulkCount} logged in bulk` : "detailed entries"} />
        <Kpi label="Converted" value={String(report.converted)} />
        <Kpi label="Conversion %" value={`${report.conversionPct}%`} />
        <Kpi label="Open" value={String(report.open)} />
        <Kpi label="Lost" value={String(report.lost)} />
      </div>

      {report.bulkCount > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Bulk daily counts</CardTitle>
            <CardDescription>
              {report.bulkCount} leads logged as daily counts (§3.1) — no per-lead
              conversion tracked, so they aren&apos;t in the conversion % above.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {report.bulkBySource.map((b) => (
                <Badge key={b.source} variant="outline">
                  {LEAD_SOURCE_LABELS[b.source]}: {b.count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <ConversionTable
        title="By sales executive"
        labelHead="SE"
        rows={report.bySE}
        onExport={() => exportGroup("se", report.bySE, "SE")}
      />
      <ConversionTable
        title="By source"
        labelHead="Source"
        rows={report.bySource.map((r) => ({ ...r, label: LEAD_SOURCE_LABELS[r.label as keyof typeof LEAD_SOURCE_LABELS] ?? r.label }))}
        onExport={() => exportGroup("source", report.bySource, "Source")}
      />
      <ConversionTable
        title="By campaign"
        labelHead="Campaign"
        rows={report.byCampaign}
        onExport={() => exportGroup("campaign", report.byCampaign, "Campaign")}
      />
      <ConversionTable
        title="By date"
        labelHead="Date"
        rows={report.byDate}
        onExport={() => exportGroup("date", report.byDate, "Date")}
      />

      {/* Lost reasons */}
      <Card>
        <CardHeader>
          <CardTitle>Lost reasons</CardTitle>
          <CardDescription>Why {report.lost} leads were lost in this range.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reason</TableHead>
                  <TableHead className="w-[40%]">Share</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.lostReasons.map((r) => (
                  <TableRow key={r.reason}>
                    <TableCell className="font-medium">{LOST_REASON_LABELS[r.reason]}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-destructive/70" style={{ width: `${r.share}%` }} />
                        </div>
                        <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
                          {r.share}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">{r.count}</TableCell>
                  </TableRow>
                ))}
                {report.lostReasons.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                      No lost leads in this range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ConversionTable({
  title,
  labelHead,
  rows,
  onExport,
}: {
  title: string;
  labelHead: string;
  rows: LeadConversionRow[];
  onExport: () => void;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        <Button variant="outline" size="sm" onClick={onExport} disabled={rows.length === 0}>
          Export CSV
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{labelHead}</TableHead>
                <TableHead className="w-[30%]">Volume</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Converted</TableHead>
                <TableHead className="text-right">Conversion %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary/70"
                        style={{ width: `${max > 0 ? (r.total / max) * 100 : 0}%` }}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{r.total}</TableCell>
                  <TableCell className="text-right">{r.converted}</TableCell>
                  <TableCell className="text-right font-medium">{r.conversionPct}%</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    No leads in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardHeader>
    </Card>
  );
}
