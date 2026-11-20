import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/base/buttons/button";
import { InputBase as Input } from "@/components/base/input/input";
import { Label } from "@/components/base/input/label";
import { Chip } from "@/components/base/badges/chip";
import { Select, SelectItem } from "@/components/base/select/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProgressBar } from "@/components/base/progress/progress";
import { Divider } from "@/components/base/divider/divider";
import { toast } from "@/components/base/toast/toast";
import { useRegistry } from "@/context/RegistryContext";
import {
  DEFAULT_BOOKLET,
  FLAT_SUBJECT,
  flattenSubjectAnswers,
  isCompleteBookletAnswers,
  mergeSubjectSpecs,
  normalizeAnswerLetters,
  normalizeBookletAnswers,
  pickBookletAnswers,
  subjectRanges,
  subjectsFromAnswers,
  type BookletAnswers,
  type SubjectSpec,
} from "@/lib/optic-evaluation";
import {
  Upload,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  XCircle,
  HelpCircle,
  BookOpen,
  AlertCircle,
  Download,
  FileScan,
  Sparkles,
} from "lucide-react";

type AnswerChar = "A" | "B" | "C" | "D" | "E" | "";

interface StudentRow {
  dosya: string;
  qr: string;
  toplamSoru: number;
  cevaplanan: number;
  cevaplar: AnswerChar[];
  kitapcikTuru: string;
  dersCevaplari?: Record<string, string[]>;
}

type SoruSonuc = "dogru" | "yanlis" | "bos";

interface DersSonuc {
  subject: string;
  dogru: number;
  yanlis: number;
  bos: number;
  net: number;
  puan: number;
}

interface KarsilastirmaSonuc {
  satir: number;
  dosya: string;
  qr: string;
  kitapcikTuru: string;
  dogru: number;
  yanlis: number;
  bos: number;
  net: number;
  puan: number;
  soruSonuclari: SoruSonuc[];
  dersSonuclari: DersSonuc[];
}

type PenaltyRule = "none" | "3to1" | "4to1";

type CikarmaYontemi = "mevcut" | "tum" | "ilk_n" | "son_n" | "ayirici";

function parseCsvLine(line: string): string[] {
  const row: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      row.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  row.push(current.trim());
  return row;
}

function parseCsv(text: string): string[][] {
  return text.split(/\r?\n/).filter((l) => l.length > 0).map(parseCsvLine);
}

const answerOptions: AnswerChar[] = ["A", "B", "C", "D", "E"];

function emptySubjectAnswers(specs: SubjectSpec[]): Record<string, AnswerChar[]> {
  return Object.fromEntries(
    specs.map((spec) => [spec.subject, Array.from({ length: spec.questionCount }, () => "" as AnswerChar)]),
  );
}

export default function Evaluation() {
  const { selectedExamId, exams } = useRegistry();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [openBooklet, setOpenBooklet] = useState<string | null>(null);

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [numQuestions, setNumQuestions] = useState(0);

  const [cikarmaYontemi, setCikarmaYontemi] = useState<CikarmaYontemi>("mevcut");
  const [cikarmaParam, setCikarmaParam] = useState("1");
  const [cikarmaAyirici, setCikarmaAyirici] = useState("-");

  const [kitapcikTurleri, setKitapcikTurleri] = useState<string[]>([]);
  const [answerKeys, setAnswerKeys] = useState<BookletAnswers>({});
  const [subjects, setSubjects] = useState<SubjectSpec[]>([]);
  const [penaltyRule, setPenaltyRule] = useState<PenaltyRule>("none");
  const [loadingSaved, setLoadingSaved] = useState(false);

  const [sonuclar, setSonuclar] = useState<KarsilastirmaSonuc[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsingProgress, setParsingProgress] = useState({ current: 0, total: 0, phase: "" as "" | "okunuyor" | "ayristiriliyor" });

  const activeExam = exams.find((e) => e.id === selectedExamId);

  const effectiveSubjects = useMemo<SubjectSpec[]>(() => {
    if (subjects.length > 0) return subjects;
    const qCount = numQuestions || students[0]?.cevaplar.length || 0;
    return qCount > 0 ? [{ subject: FLAT_SUBJECT, questionCount: qCount, optionCount: 5 }] : [];
  }, [subjects, numQuestions, students]);

  const showSubjectBreakdown = effectiveSubjects.length > 1;

  useEffect(() => {
    const raw = sessionStorage.getItem("directEvaluationPayload");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const payload = Array.isArray(parsed)
        ? { students: parsed as StudentRow[] }
        : (parsed as {
            students?: StudentRow[];
            subjects?: SubjectSpec[];
            answerKeys?: Array<{ kitapcikTuru: string; answers: Record<string, string[]> }>;
          });
      const payloadStudents = Array.isArray(payload.students) ? payload.students : [];
      if (payloadStudents.length > 0) {
        const qCount = payloadStudents[0]?.toplamSoru || payloadStudents[0]?.cevaplar.length || 0;
        const payloadSubjects = (payload.subjects ?? []).filter((spec) => spec.questionCount > 0);
        const resolvedSubjects = payloadSubjects.length > 0
          ? payloadSubjects
          : qCount > 0
            ? [{ subject: FLAT_SUBJECT, questionCount: qCount, optionCount: 5 }]
            : [];
        const normalizedStudents: StudentRow[] = payloadStudents.map((student) => {
          const flat = student.dersCevaplari
            ? flattenSubjectAnswers(resolvedSubjects, student.dersCevaplari)
            : student.cevaplar;
          return {
            ...student,
            cevaplar: flat.map((char) => (char === "" ? "" : (char as AnswerChar))),
            toplamSoru: flat.length,
          };
        });
        const normalizedKeys = normalizeBookletAnswers(
          payload.answerKeys
            ? Object.fromEntries(payload.answerKeys.map((entry) => [entry.kitapcikTuru, entry.answers]))
            : {},
        );
        const bookletsToUse = Array.from(new Set([
          ...normalizedStudents.map((student) => student.kitapcikTuru).filter((booklet) => booklet && booklet.trim()),
          ...Object.keys(normalizedKeys),
        ]));
        const finalBooklets = bookletsToUse.length > 0 ? bookletsToUse : [DEFAULT_BOOKLET];
        setStudents(normalizedStudents);
        setNumQuestions(normalizedStudents[0]?.toplamSoru ?? qCount);
        setSubjects(resolvedSubjects);
        setKitapcikTurleri(finalBooklets);
        setAnswerKeys(Object.fromEntries(
          finalBooklets.map((booklet) => [
            booklet,
            normalizedKeys[booklet] ?? emptySubjectAnswers(resolvedSubjects),
          ]),
        ));
        setSonuclar(null);
        toast.success("Optik okuma verileri yüklendi", { description: `${payloadStudents.length} öğrenci aktarıldı.` });
      }
    } catch (e) {
      console.error("Doğrudan değerlendirme yükleme hatası:", e);
    } finally {
      sessionStorage.removeItem("directEvaluationPayload");
    }
  }, []);

  const handleLoadFromSavedScans = async () => {
    if (!selectedExamId) {
      toast.error("Sınav seçilmedi", { description: "Önce başlangıçtan bir sınav seçin." });
      return;
    }
    setLoadingSaved(true);
    try {
      const res = await fetch(`/api/optics/scans?examId=${encodeURIComponent(selectedExamId)}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Kayıtlı taramalar alınamadı");
      const scans = (await res.json()) as Array<{
        fileName: string;
        qr: string;
        booklet: string;
        formDesignId?: string;
        formVersion?: number;
        results: Array<{
          subject: string;
          answers: Array<{ questionNumber: number; answer: string }>;
        }>;
      }>;
      if (scans.length === 0) {
        toast.error("Tarama kaydı yok", { description: "Bu sınav için kaydedilmiş optik tarama bulunamadı." });
        return;
      }

      const subjectCounts = new Map<string, number>();
      for (const scan of scans) {
        for (const result of scan.results || []) {
          const count = result.answers?.length ?? 0;
          subjectCounts.set(result.subject, Math.max(subjectCounts.get(result.subject) ?? 0, count));
        }
      }
      const scanSubjects: SubjectSpec[] = Array.from(subjectCounts, ([subject, questionCount]) => ({
        subject,
        questionCount,
        optionCount: 5,
      }));

      const parsed: StudentRow[] = scans.map((scan) => {
        const dersCevaplari: Record<string, string[]> = {};
        for (const result of scan.results || []) {
          dersCevaplari[result.subject] = (result.answers || []).map((answer) =>
            (answer.answer || "").toUpperCase(),
          );
        }
        const allAnswers = flattenSubjectAnswers(scanSubjects, dersCevaplari);
        return {
          dosya: scan.fileName || "",
          qr: scan.qr || "",
          kitapcikTuru: (scan.booklet || "").toUpperCase(),
          toplamSoru: allAnswers.length,
          cevaplanan: allAnswers.filter(Boolean).length,
          cevaplar: allAnswers as AnswerChar[],
          dersCevaplari,
        };
      });

      let resolvedSubjects = scanSubjects;
      let normalizedKeys: BookletAnswers = {};
      const formScan = scans.find((scan) => scan.formDesignId);
      if (formScan?.formDesignId) {
        const query = new URLSearchParams({
          examId: selectedExamId,
          formDesignId: formScan.formDesignId,
          formVersion: String(formScan.formVersion ?? 1),
        });
        const keyResponse = await fetch(`/api/optics/answer-keys?${query}`, {
          credentials: "include",
          cache: "no-store",
        });
        if (keyResponse.ok) {
          const { answerKey } = (await keyResponse.json()) as { answerKey: { answers: unknown } | null };
          if (answerKey) {
            normalizedKeys = normalizeBookletAnswers(answerKey.answers);
            const keySubjects = subjectsFromAnswers(Object.values(normalizedKeys)[0]);
            resolvedSubjects = mergeSubjectSpecs(scanSubjects, keySubjects);
          }
        }
      }

      const finalStudents: StudentRow[] = parsed.map((student) => {
        const flat = flattenSubjectAnswers(resolvedSubjects, student.dersCevaplari);
        return {
          ...student,
          cevaplar: flat.map((char) => (char === "" ? "" : (char as AnswerChar))),
          toplamSoru: flat.length,
        };
      });
      const scanBooklets = finalStudents
        .map((student) => student.kitapcikTuru)
        .filter((booklet) => booklet && booklet.trim());
      const bookletsToUse = Array.from(new Set([...scanBooklets, ...Object.keys(normalizedKeys)]));
      const finalBooklets = bookletsToUse.length > 0 ? bookletsToUse : [DEFAULT_BOOKLET];

      setStudents(finalStudents);
      setNumQuestions(finalStudents[0]?.toplamSoru || 0);
      setSubjects(resolvedSubjects);
      setKitapcikTurleri(finalBooklets);
      setAnswerKeys(Object.fromEntries(
        finalBooklets.map((booklet) => [
          booklet,
          normalizedKeys[booklet] ?? emptySubjectAnswers(resolvedSubjects),
        ]),
      ));
      setSonuclar(null);
      toast.success("Veriler başarıyla çekildi", { description: `${finalStudents.length} öğrenci taraması yüklendi.` });
    } catch (err: unknown) {
      toast.error("Yükleme hatası", { description: err instanceof Error ? err.message : "Bilinmeyen hata" });
    } finally {
      setLoadingSaved(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv")) {
      toast.error("Geçersiz dosya", { description: "Lütfen CSV dosyası seçin." });
      return;
    }
    setCsvFile(file);
    setStudents([]);
    setNumQuestions(0);
    setKitapcikTurleri([]);
    setAnswerKeys({});
    setSubjects([]);
    setSonuclar(null);
    setParsingProgress({ current: 0, total: 0, phase: "" });
  };

  const handleParseCsv = useCallback(async () => {
    if (!csvFile) return;
    setParsing(true);
    setParsingProgress({ current: 0, total: 0, phase: "okunuyor" });

    try {
      const text = await csvFile.text();
      // BOM temizle
      const cleanText = text.replace(/^\uFEFF/, "");
      const rawRows = parseCsv(cleanText);

      if (rawRows.length < 2) {
        toast.error("CSV hatası", { description: "En az bir başlık ve bir veri satırı gerekli." });
        setParsing(false);
        return;
      }

      const header = rawRows[0];
      const idxDosya = header.findIndex((h) => h === "Dosya");
      const idxQr = header.findIndex((h) => h === "QR");
      const idxKitapcik = header.findIndex((h) => h === "Kitapçık Türü");
      const idxToplam = header.findIndex((h) => h === "Toplam Soru");
      const idxCevaplanan = header.findIndex((h) => h === "Cevaplanan");

      const idxQuestions: number[] = [];
      for (let i = 0; i < header.length; i++) {
        if (/^Soru\s+\d+$/i.test(header[i])) {
          idxQuestions.push(i);
        }
      }

      if (idxDosya === -1 || idxQuestions.length === 0) {
        toast.error("CSV formatı hatalı", { description: "'Dosya' ve 'Soru N' sütunları bulunamadı." });
        setParsing(false);
        return;
      }

      const dataRows = rawRows.slice(1);
      const total = dataRows.length;
      const chunkSize = 1000;
      const parsed: StudentRow[] = [];

      setParsingProgress({ current: 0, total, phase: "ayristiriliyor" });

      for (let start = 0; start < total; start += chunkSize) {
        const end = Math.min(start + chunkSize, total);
        const chunk = dataRows.slice(start, end);
        for (const row of chunk) {
          const cevaplar: AnswerChar[] = idxQuestions.map((qi) => {
            const val = (row[qi] || "").trim().toUpperCase();
            return answerOptions.includes(val as AnswerChar) ? (val as AnswerChar) : "";
          });
          parsed.push({
            dosya: row[idxDosya] || "",
            qr: idxQr !== -1 ? (row[idxQr] || "") : "",
            toplamSoru: idxToplam !== -1 ? parseInt(row[idxToplam]) || 0 : idxQuestions.length,
            cevaplanan: idxCevaplanan !== -1 ? parseInt(row[idxCevaplanan]) || 0 : cevaplar.filter((c) => c !== "").length,
            cevaplar,
            kitapcikTuru: idxKitapcik !== -1 ? (row[idxKitapcik] || "").trim().toUpperCase() : "",
          });
        }
        setParsingProgress({ current: end, total, phase: "ayristiriliyor" });
        // Her chunk sonrası UI'ya nefes aldır
        await new Promise((r) => setTimeout(r, 0));
      }

      if (parsed.length === 0) {
        toast.error("Veri bulunamadı", { description: "CSV'de öğrenci satırı yok." });
        setParsing(false);
        return;
      }

      const qCounts = parsed.map((s) => s.toplamSoru).filter((n) => n > 0);
      const detectedQ = qCounts.length > 0
        ? qCounts.sort((a, b) => a - b)[Math.floor(qCounts.length / 2)]
        : idxQuestions.length;

      setStudents(parsed);
      setNumQuestions(detectedQ);
      setSubjects([]);
      setSonuclar(null);

      extractKitapcikTurleri(parsed, "mevcut", "", "", [
        { subject: FLAT_SUBJECT, questionCount: detectedQ, optionCount: 5 },
      ]);

      toast(`${parsed.length} öğrenci yüklendi`, { description: `${detectedQ} soru tespit edildi.` });
    } catch (err) {
      toast.error("CSV ayrıştırma hatası", { description: String(err) });
    }
    setParsing(false);
  }, [csvFile, toast]);

  const extractKitapcikTurleri = useCallback(
    (
      rows: StudentRow[],
      yontem: CikarmaYontemi,
      param: string,
      ayirici: string,
      specs: SubjectSpec[],
    ): string[] => {
      const turler = rows.map((s) => {
        if (yontem === "mevcut") return s.kitapcikTuru?.trim().toUpperCase() || DEFAULT_BOOKLET;
        const qr = s.qr;
        if (!qr) return "(QR yok)";
        switch (yontem) {
          case "tum":
            return qr;
          case "ilk_n": {
            const n = parseInt(param) || 1;
            return qr.slice(0, n);
          }
          case "son_n": {
            const n = parseInt(param) || 1;
            return qr.slice(-n);
          }
          case "ayirici": {
            const sep = ayirici || "-";
            const idx = (parseInt(param) || 0);
            const parts = qr.split(sep);
            return parts[idx] || qr;
          }
          default:
            return qr;
        }
      });

      const updated = rows.map((s, i) => ({ ...s, kitapcikTuru: turler[i] }));
      setStudents(updated);

      const unique = Array.from(new Set(turler)).sort();
      setKitapcikTurleri(unique.length > 0 ? unique : [DEFAULT_BOOKLET]);

      setAnswerKeys((previous) => Object.fromEntries(
        (unique.length > 0 ? unique : [DEFAULT_BOOKLET]).map((booklet) => [
          booklet,
          previous[booklet] ?? emptySubjectAnswers(specs),
        ]),
      ));

      return unique;
    },
    []
  );

  const handleApplyExtraction = useCallback(() => {
    if (students.length === 0) return;
    extractKitapcikTurleri(students, cikarmaYontemi, cikarmaParam, cikarmaAyirici, effectiveSubjects);
    setSonuclar(null);
  }, [students, cikarmaYontemi, cikarmaParam, cikarmaAyirici, effectiveSubjects, extractKitapcikTurleri]);

  const updateAnswerKey = (booklet: string, subject: string, value: string) => {
    setAnswerKeys((previous) => ({
      ...previous,
      [booklet]: {
        ...previous[booklet],
        [subject]: Array.from(value) as AnswerChar[],
      },
    }));
  };

  const handleCompare = useCallback(() => {
    if (students.length === 0 || Object.keys(answerKeys).length === 0) {
      toast.error("Veri eksik", { description: "Öğrenci cevapları ve cevap anahtarı gerekli." });
      return;
    }

    const incompleteBooklets = kitapcikTurleri.filter(
      (booklet) => !isCompleteBookletAnswers(effectiveSubjects, answerKeys[booklet]),
    );
    if (incompleteBooklets.length > 0) {
      toast.error("Cevap anahtarı eksik", {
        description: `${incompleteBooklets.join(", ")} kitapçığında eksik ders/soru var.`,
      });
      return;
    }

    const penaltyDivider = penaltyRule === "3to1" ? 3 : penaltyRule === "4to1" ? 4 : 0;
    const ranges = subjectRanges(effectiveSubjects);
    const missingBooklets = new Set<string>();

    const results: KarsilastirmaSonuc[] = students.map((s, si) => {
      const key = pickBookletAnswers(answerKeys, s.kitapcikTuru);
      if (!key) missingBooklets.add(s.kitapcikTuru || "(kitapçık yok)");
      const expected = key ? flattenSubjectAnswers(effectiveSubjects, key) : [];
      const soruSonuclari: SoruSonuc[] = s.cevaplar.map((c, qi) => {
        if (!key || !expected[qi] || c === "") return "bos";
        return expected[qi] === c ? "dogru" : "yanlis";
      });

      const dersSonuclari: DersSonuc[] = ranges.map((range) => {
        const slice = soruSonuclari.slice(range.start, range.end);
        const dogru = slice.filter((r) => r === "dogru").length;
        const yanlis = slice.filter((r) => r === "yanlis").length;
        const bos = slice.filter((r) => r === "bos").length;
        const netRaw = penaltyDivider > 0 ? dogru - yanlis / penaltyDivider : dogru;
        const net = Math.max(0, parseFloat(netRaw.toFixed(2)));
        const puan = parseFloat(((net / Math.max(1, slice.length)) * 100).toFixed(2));
        return { subject: range.subject, dogru, yanlis, bos, net, puan };
      });

      const dogru = soruSonuclari.filter((r) => r === "dogru").length;
      const yanlis = soruSonuclari.filter((r) => r === "yanlis").length;
      const bos = soruSonuclari.filter((r) => r === "bos").length;
      const net = parseFloat(dersSonuclari.reduce((sum, item) => sum + item.net, 0).toFixed(2));
      const totalQ = s.toplamSoru || soruSonuclari.length || 1;
      const puan = parseFloat(((net / totalQ) * 100).toFixed(2));

      return {
        satir: si + 1,
        dosya: s.dosya,
        qr: s.qr,
        kitapcikTuru: s.kitapcikTuru,
        dogru,
        yanlis,
        bos,
        net,
        puan,
        soruSonuclari,
        dersSonuclari,
      };
    });

    setSonuclar(results);
    if (missingBooklets.size > 0) {
      toast.error("Kitapçık anahtarı bulunamadı", {
        description: `${Array.from(missingBooklets).join(", ")} için cevap anahtarı yok; bu öğrenciler boş sayıldı.`,
      });
    } else {
      toast.success("Karşılaştırma tamam", { description: `${results.length} öğrenci değerlendirildi.` });
    }
  }, [students, answerKeys, kitapcikTurleri, effectiveSubjects, penaltyRule, toast]);

  const sonucToCsv = useCallback(() => {
    if (!sonuclar || sonuclar.length === 0) return;
    const header = [
      "#",
      "Dosya",
      "QR",
      "Kitapçık Türü",
      "Doğru",
      "Yanlış",
      "Boş",
      "Net",
      "Puan (%100)",
      ...effectiveSubjects.map((spec) => `${spec.subject} Net`),
      ...Array.from({ length: numQuestions }, (_, i) => `Soru ${i + 1}`),
    ];
    const rows = sonuclar.map((s) => [
      String(s.satir),
      s.dosya,
      s.qr,
      s.kitapcikTuru,
      String(s.dogru),
      String(s.yanlis),
      String(s.bos),
      String(s.net),
      String(s.puan),
      ...s.dersSonuclari.map((item) => String(item.net)),
      ...s.soruSonuclari.map((r) => (r === "dogru" ? "✓" : r === "yanlis" ? "✗" : "—")),
    ]);
    const csv = "\uFEFF" + [header.join(";"), ...rows.map((r) => r.join(";"))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "degerlendirme-sonuc.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [sonuclar, numQuestions, effectiveSubjects]);

  return (
    <div className="space-y-6">
      {/* Başlık */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-title-1-semibold tracking-tight text-text-primary">Değerlendirme</h1>
          <p className="mt-1 text-body-regular text-text-secondary">
            Optik okuma sonuçlarını yükleyin, cevap anahtarlarını girin ve net/puan karşılaştırması yapın.
          </p>
          {activeExam && (
            <p className="mt-1 text-caption-1-medium text-accent-600">
              Aktif Sınav: {activeExam.name}
            </p>
          )}
        </div>
      </div>

      <Divider />

      {/* 1. Veri Yükleme */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            1. Veri Kaynağı Seçin
          </CardTitle>
          <CardDescription>
            Sistemdeki kayıtlı optik taramalardan doğrudan çekebilir veya harici bir CSV dosyası yükleyebilirsiniz.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              onClick={handleLoadFromSavedScans}
              disabled={loadingSaved || !selectedExamId}
              leadingIcon={loadingSaved ? Loader2 : FileScan}
            >
              {loadingSaved ? "Taramalar Yükleniyor..." : "Aktif Sınavın Taramalarından Yükle"}
            </Button>
            <span className="text-caption-1-medium text-text-tertiary">veya CSV seçin:</span>
            <Input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              fieldClassName="max-w-xs"
            />
            <Button onClick={handleParseCsv} disabled={!csvFile || parsing} variant="ghost">
              {parsing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FileSpreadsheet className="w-4 h-4 mr-2" />}
              {parsing ? "Ayrıştırılıyor..." : "CSV'yi Yükle & Ayrıştır"}
            </Button>
          </div>
          {parsing && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-tertiary">
                  {parsingProgress.phase === "okunuyor" ? "Dosya okunuyor..." : "Satırlar ayrıştırılıyor..."}
                </span>
                {parsingProgress.total > 0 ? (
                  <span className="font-medium">{parsingProgress.current} / {parsingProgress.total} satır</span>
                ) : (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
              </div>
              <ProgressBar
                aria-label="CSV ayrıştırma ilerlemesi"
                value={parsingProgress.total > 0 ? (parsingProgress.current / parsingProgress.total) * 100 : 0}
                isIndeterminate={parsingProgress.total === 0}
              />
            </div>
          )}
          {csvFile && !parsing && (
            <p className="text-sm text-text-tertiary">
              Seçilen dosya: <strong>{csvFile.name}</strong> ({(csvFile.size / 1024).toFixed(1)} KB)
            </p>
          )}
        </CardContent>
      </Card>

      {/* 2. Öğrenci Cevapları */}
      {students.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5" />
              2. Öğrenci Cevapları ({students.length} öğrenci, {numQuestions} soru)
            </CardTitle>
            <CardDescription>
              Kitapçık türü çıkarma yöntemini belirleyip <strong>Uygula</strong>'ya tıklayın.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Label>Çıkarma Yöntemi</Label>
                <Select
                  selectedKey={cikarmaYontemi}
                  onSelectionChange={(key) => setCikarmaYontemi(String(key) as CikarmaYontemi)}
                  triggerClassName="w-56"
                >
                  <SelectItem id="mevcut">Mevcut kitapçık değerini koru</SelectItem>
                  <SelectItem id="tum">QR'ın Tamamı</SelectItem>
                  <SelectItem id="ilk_n">İlk N Karakter</SelectItem>
                  <SelectItem id="son_n">Son N Karakter</SelectItem>
                  <SelectItem id="ayirici">Ayırıcı ile Böl</SelectItem>
                </Select>
              </div>

              {(cikarmaYontemi === "ilk_n" || cikarmaYontemi === "son_n") && (
                <div className="space-y-1.5">
                  <Label htmlFor="n-karakter-sayisi">N (karakter sayısı)</Label>
                  <Input
                    id="n-karakter-sayisi"
                    type="number"
                    min={1}
                    max={50}
                    value={cikarmaParam}
                    onChange={(e) => setCikarmaParam(e.target.value)}
                    fieldClassName="w-20"
                  />
                </div>
              )}

              {cikarmaYontemi === "ayirici" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="ayirici-2">Ayırıcı</Label>
                    <Input
                      id="ayirici-2"
                      value={cikarmaAyirici}
                      onChange={(e) => setCikarmaAyirici(e.target.value)}
                      fieldClassName="w-20"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="indeks-0-dan-baslar">İndeks (0'dan başlar)</Label>
                    <Input
                      id="indeks-0-dan-baslar"
                      type="number"
                      min={0}
                      max={20}
                      value={cikarmaParam}
                      onChange={(e) => setCikarmaParam(e.target.value)}
                      fieldClassName="w-20"
                    />
                  </div>
                </>
              )}

              <Button onClick={handleApplyExtraction} variant="ghost">Uygula</Button>
            </div>

            {/* Öğrenci tablosu (ilk 10 satır) */}
            <div className="border rounded-md overflow-auto max-h-80">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Dosya</TableHead>
                    <TableHead>QR</TableHead>
                    <TableHead>Kitapçık Türü</TableHead>
                    {Array.from({ length: Math.min(numQuestions, 5) }, (_, i) => (
                      <TableHead key={i} className="text-center w-12">S.{i + 1}</TableHead>
                    ))}
                    {numQuestions > 5 && <TableHead className="text-center">...</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.slice(0, 10).map((s, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-text-tertiary">{i + 1}</TableCell>
                      <TableCell className="max-w-40 truncate" title={s.dosya}>{s.dosya}</TableCell>
                      <TableCell className="max-w-40 truncate" title={s.qr}>{s.qr}</TableCell>
                      <TableCell>
                        <Chip variant="subtle" color="neutral">{s.kitapcikTuru || "—"}</Chip>
                      </TableCell>
                      {s.cevaplar.slice(0, 5).map((c, qi) => (
                        <TableCell key={qi} className="text-center font-mono">{c || "—"}</TableCell>
                      ))}
                      {numQuestions > 5 && <TableCell className="text-center text-text-tertiary">...</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {students.length > 10 && (
              <p className="text-xs text-text-tertiary">İlk 10 satır gösteriliyor ({students.length} öğrenci).</p>
            )}

            {kitapcikTurleri.length > 0 && (
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-sm font-medium">Tespit edilen kitapçık türleri:</span>
                {kitapcikTurleri.map((t) => (
                  <Chip key={t} variant="subtle" color="neutral">{t}</Chip>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 3. Cevap Anahtarları */}
      {kitapcikTurleri.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              3. Cevap Anahtarları
            </CardTitle>
            <CardDescription>
              Her kitapçık türü için ders bazında doğru cevapları girin (toplam {numQuestions} soru).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {kitapcikTurleri.map((booklet) => {
              const bookletAnswers = answerKeys[booklet] ?? {};
              const completeCount = effectiveSubjects.filter(
                (spec) => (bookletAnswers[spec.subject]?.length ?? 0) === spec.questionCount,
              ).length;
              return (
                <div key={booklet} className="space-y-3 rounded-lg border border-separator-border p-3">
                  <Button
                    variant="ghost"
                    onClick={() => setOpenBooklet(openBooklet === booklet ? null : booklet)}
                    className="flex flex-wrap items-center justify-between gap-2 w-full text-left"
                  >
                    <span className="text-sm font-semibold flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-text-tertiary" />
                      {openBooklet === booklet ? "▼" : "▶"} Kitapçık Türü: <Chip variant="subtle" color="blue">{booklet}</Chip>
                    </span>
                    <span className="text-xs text-text-tertiary">
                      {completeCount}/{effectiveSubjects.length} ders tamam
                    </span>
                  </Button>
                  <AnimatePresence>
                    {openBooklet === booklet && (
                      <motion.div
                        key="evaluation-answers"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        className="overflow-hidden space-y-2 pt-1"
                      >
                        {effectiveSubjects.map((spec) => {
                          const value = (bookletAnswers[spec.subject] ?? []).join("");
                          const allowed = answerOptions.slice(0, spec.optionCount);
                          return (
                            <div key={spec.subject} className="space-y-1">
                              <Label htmlFor={`eval-key-${booklet}-${spec.subject}`}>
                                {spec.subject} · {value.length}/{spec.questionCount} soru · {allowed.join("/")}
                              </Label>
                              <Input
                                id={`eval-key-${booklet}-${spec.subject}`}
                                value={value}
                                placeholder={`${spec.questionCount} cevap (örn. ${allowed.join("")}...)`}
                                onChange={(event) =>
                                  updateAnswerKey(
                                    booklet,
                                    spec.subject,
                                    normalizeAnswerLetters(event.target.value, spec.questionCount, spec.optionCount),
                                  )
                                }
                              />
                            </div>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div>
                <Label className="text-caption-1-medium mb-1.5 block">Net / Ceza Puanı Kuralı</Label>
                <Select
                  selectedKey={penaltyRule}
                  onSelectionChange={(key) => setPenaltyRule(String(key) as PenaltyRule)}
                  size="sm"
                >
                  <SelectItem id="none">Yanlış doğruyu götürmez (Net = Doğru)</SelectItem>
                  <SelectItem id="3to1">3 Yanlış 1 Doğruyu Götürür (Ortaokul / LGS)</SelectItem>
                  <SelectItem id="4to1">4 Yanlış 1 Doğruyu Götürür (Lise / YKS)</SelectItem>
                </Select>
              </div>
              <Button onClick={handleCompare} size="medium" className="w-full" variant="ghost" leadingIcon={CheckCircle2}>
                Karşılaştır & Değerlendir
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 4. Sonuçlar */}
      {sonuclar && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5" />
              4. Karşılaştırma Sonuçları
            </CardTitle>
            <CardDescription>
              {sonuclar.length} öğrenci değerlendirildi. Ortalama doğru: {(sonuclar.reduce((s, r) => s + r.dogru, 0) / sonuclar.length).toFixed(1)} · Ortalama Net: {(sonuclar.reduce((s, r) => s + r.net, 0) / sonuclar.length).toFixed(2)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border rounded-md overflow-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Dosya</TableHead>
                    <TableHead>Kitapçık</TableHead>
                    <TableHead className="text-center text-status-lime-text">Doğru</TableHead>
                    <TableHead className="text-center text-status-rose-text">Yanlış</TableHead>
                    <TableHead className="text-center text-text-tertiary">Boş</TableHead>
                    <TableHead className="text-center font-semibold text-accent-600">Net</TableHead>
                    <TableHead className="text-center font-semibold text-text-primary">Puan</TableHead>
                    {showSubjectBreakdown && effectiveSubjects.map((spec) => (
                      <TableHead key={spec.subject} className="text-center">{spec.subject}</TableHead>
                    ))}
                    {Array.from({ length: Math.min(numQuestions, 8) }, (_, i) => (
                      <TableHead key={i} className="text-center w-10">S.{i + 1}</TableHead>
                    ))}
                    {numQuestions > 8 && <TableHead className="text-center">...</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sonuclar.map((s) => (
                    <TableRow key={s.satir}>
                      <TableCell className="text-text-tertiary">{s.satir}</TableCell>
                      <TableCell className="max-w-32 truncate" title={s.dosya}>{s.dosya}</TableCell>
                      <TableCell><Chip variant="caption" color="neutral">{s.kitapcikTuru}</Chip></TableCell>
                      <TableCell className="text-center font-medium text-status-lime-text">{s.dogru}</TableCell>
                      <TableCell className="text-center font-medium text-status-rose-text">{s.yanlis}</TableCell>
                      <TableCell className="text-center font-medium text-text-tertiary">{s.bos}</TableCell>
                      <TableCell className="text-center font-bold text-accent-600">{s.net}</TableCell>
                      <TableCell className="text-center font-bold text-text-primary">{s.puan}</TableCell>
                      {showSubjectBreakdown && s.dersSonuclari.map((item) => (
                        <TableCell key={item.subject} className="text-center">
                          <span className="font-semibold text-accent-600">{item.net}</span>
                          <span className="block text-[10px] text-text-tertiary">
                            {item.dogru}D/{item.yanlis}Y/{item.bos}B
                          </span>
                        </TableCell>
                      ))}
                      {s.soruSonuclari.slice(0, 8).map((r, qi) => (
                        <TableCell key={qi} className="text-center">
                          {r === "dogru" ? (
                            <CheckCircle2 className="w-4 h-4 text-status-lime-text inline" />
                          ) : r === "yanlis" ? (
                            <XCircle className="w-4 h-4 text-status-rose-text inline" />
                          ) : (
                            <HelpCircle className="w-4 h-4 text-text-tertiary/50 inline" />
                          )}
                        </TableCell>
                      ))}
                      {numQuestions > 8 && <TableCell className="text-center text-text-tertiary">...</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* İstatistik */}
            <div className="flex flex-wrap gap-4">
              <div className="bg-background-secondary-default rounded-lg p-3 flex-1 min-w-[120px]">
                <p className="text-xs text-text-tertiary">Toplam Öğrenci</p>
                <p className="text-2xl font-bold">{sonuclar.length}</p>
              </div>
              <div className="bg-background-secondary-default rounded-lg p-3 flex-1 min-w-[120px]">
                <p className="text-xs text-text-tertiary">Ortalama Doğru</p>
                <p className="text-2xl font-bold text-status-lime-text">
                  {(sonuclar.reduce((s, r) => s + r.dogru, 0) / sonuclar.length).toFixed(1)}
                </p>
              </div>
              <div className="bg-background-secondary-default rounded-lg p-3 flex-1 min-w-[120px]">
                <p className="text-xs text-text-tertiary">Ortalama Yanlış</p>
                <p className="text-2xl font-bold text-status-rose-text">
                  {(sonuclar.reduce((s, r) => s + r.yanlis, 0) / sonuclar.length).toFixed(1)}
                </p>
              </div>
              <div className="bg-background-secondary-default rounded-lg p-3 flex-1 min-w-[120px]">
                <p className="text-xs text-text-tertiary">Ortalama Boş</p>
                <p className="text-2xl font-bold text-text-tertiary">
                  {(sonuclar.reduce((s, r) => s + r.bos, 0) / sonuclar.length).toFixed(1)}
                </p>
              </div>
              <div className="bg-background-secondary-default rounded-lg p-3 flex-1 min-w-[120px]">
                <p className="text-xs text-text-tertiary">Ortalama Net</p>
                <p className="text-2xl font-bold text-accent-600">
                  {(sonuclar.reduce((s, r) => s + r.net, 0) / sonuclar.length).toFixed(2)}
                </p>
              </div>
              <div className="bg-background-secondary-default rounded-lg p-3 flex-1 min-w-[120px]">
                <p className="text-xs text-text-tertiary">Ortalama Puan</p>
                <p className="text-2xl font-bold text-text-primary">
                  {(sonuclar.reduce((s, r) => s + r.puan, 0) / sonuclar.length).toFixed(1)}
                </p>
              </div>
            </div>

            <Button variant="ghost" onClick={sonucToCsv} leadingIcon={Download}>
              
              CSV Olarak İndir
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
