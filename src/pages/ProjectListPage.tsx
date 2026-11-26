import { useMemo, useState } from "react";
import { FolderOpen, Search, Trash2 } from "lucide-react";
import { Button, Card, EmptyState, Input, SectionHeader } from "../components/ui";
import { useProjectStore } from "../store/projectStore";
import { formatDateTime, relativeTime } from "../lib/utils";

export function ProjectListPage() {
  const recents = useProjectStore((state) => state.recents);
  const openRecent = useProjectStore((state) => state.openRecent);
  const openFromFile = useProjectStore((state) => state.openFromFile);
  const removeRecent = useProjectStore((state) => state.removeRecent);
  const setView = useProjectStore((state) => state.setView);
  const pendingOpen = useProjectStore((state) => state.pendingOpen);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return recents;
    return recents.filter(
      (entry) =>
        entry.name.toLowerCase().includes(keyword) ||
        (entry.path ?? "").toLowerCase().includes(keyword),
    );
  }, [query, recents]);

  return (
    <div className="scroll-area h-full">
      <div className="mx-auto max-w-5xl px-8 py-8">
        <SectionHeader
          title="프로젝트 목록"
          description="최근에 연 프로젝트입니다. 파일은 .qws 형식으로 저장되며, 목록에서 제거해도 디스크의 파일은 삭제되지 않습니다."
          actions={
            <>
              <Button size="sm" variant="secondary" icon={<FolderOpen className="h-3.5 w-3.5" />} onClick={() => void openFromFile()} loading={pendingOpen}>
                .qws 파일 열기
              </Button>
              <Button size="sm" variant="primary" onClick={() => setView("new")}>
                새 프로젝트
              </Button>
            </>
          }
        />

        <div className="mt-5 flex items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="프로젝트 이름 또는 경로 검색"
              className="pl-8"
            />
          </div>
          <span className="text-xs text-slate-500">{filtered.length}개</span>
        </div>

        <div className="mt-4 space-y-2">
          {filtered.length ? (
            filtered.map((entry) => (
              <Card
                key={entry.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 transition hover:border-brand-300"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{entry.name}</p>
                  <p className="truncate text-[11px] text-slate-500">
                    {relativeTime(entry.updatedAt)} · {formatDateTime(entry.updatedAt)} ·{" "}
                    {entry.storage === "file" ? entry.path : "로컬 저장소"}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => void openRecent(entry)}>
                    열기
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => removeRecent(entry.id)}
                    title="목록에서 제거"
                  >
                    제거
                  </Button>
                </div>
              </Card>
            ))
          ) : (
            <EmptyState
              icon={<FolderOpen className="h-8 w-8" />}
              title={recents.length ? "검색 결과가 없습니다" : "저장된 프로젝트가 없습니다"}
              description="새 프로젝트를 만들거나 기존 .qws 파일을 불러오세요."
              action={
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => setView("new")}>
                    새 프로젝트
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void openFromFile()}>
                    파일 열기
                  </Button>
                </div>
              }
            />
          )}
        </div>

        <p className="mt-6 text-[11px] leading-relaxed text-slate-400">
          기본 저장 위치: 프로그램 데이터 폴더의 projects 하위 폴더. 프로젝트를 다른 PC로 옮길 때는
          .qws 파일 하나만 복사하면 이미지 자산까지 함께 이동합니다.
        </p>
      </div>
    </div>
  );
}
