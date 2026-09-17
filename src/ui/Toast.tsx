import { useEffect, useState } from "react";
import { render, type Msg } from "../i18n.ts";
import { useApp } from "./ctx.ts";

export function Toast({ notice }: { notice: { msg: Msg; seq: number } | null }) {
  const { lang } = useApp();
  const [on, setOn] = useState(false);
  const seq = notice?.seq ?? 0;

  useEffect(() => {
    if (!seq) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), 2600);
    return () => clearTimeout(t);
  }, [seq]);

  return (
    <div id="toast" className={on ? "on" : ""}>
      {notice ? render(lang, notice.msg) : ""}
    </div>
  );
}
