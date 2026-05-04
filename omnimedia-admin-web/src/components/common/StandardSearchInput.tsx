import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Search, XCircle } from "lucide-react";
import { useSearchParams } from "react-router-dom";

export type StandardSearchChangeMeta = {
  source: "debounce" | "submit" | "external" | "clear";
};

export type StandardSearchInputHandle = {
  clear: () => void;
  submit: () => void;
};

type StandardSearchInputProps = {
  placeholder: string;
  paramKey?: string;
  aliasParamKeys?: string[];
  clearParamKeys?: string[];
  debounceMs?: number;
  className?: string;
  inputClassName?: string;
  onSearchChange?: (value: string, meta: StandardSearchChangeMeta) => void;
};

const EMPTY_PARAM_KEYS: string[] = [];

function readSearchValue(searchParams: URLSearchParams, paramKeys: string[]): string {
  for (const key of paramKeys) {
    const value = searchParams.get(key);
    if (value !== null) {
      return value.trim();
    }
  }

  return "";
}

export const StandardSearchInput = forwardRef<
  StandardSearchInputHandle,
  StandardSearchInputProps
>(function StandardSearchInput(props, ref) {
  const {
    placeholder,
    paramKey = "search",
    aliasParamKeys = EMPTY_PARAM_KEYS,
    clearParamKeys = EMPTY_PARAM_KEYS,
    debounceMs = 320,
    className = "",
    inputClassName = "",
    onSearchChange,
  } = props;
  const [searchParams, setSearchParams] = useSearchParams();
  const paramKeys = useMemo(
    () => Array.from(new Set([paramKey, ...aliasParamKeys])),
    [aliasParamKeys, paramKey],
  );
  const initialSearchTerm = readSearchValue(searchParams, paramKeys);
  const [localSearchTerm, setLocalSearchTerm] = useState(initialSearchTerm);
  const localSearchTermRef = useRef(initialSearchTerm);
  const lastCommittedSearchRef = useRef(initialSearchTerm);
  const onSearchChangeRef = useRef(onSearchChange);

  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  }, [onSearchChange]);

  useEffect(() => {
    localSearchTermRef.current = localSearchTerm;
  }, [localSearchTerm]);

  useEffect(() => {
    const nextSearchTerm = readSearchValue(searchParams, paramKeys);

    if (nextSearchTerm === lastCommittedSearchRef.current) {
      if (localSearchTermRef.current !== nextSearchTerm) {
        setLocalSearchTerm(nextSearchTerm);
      }
      return;
    }

    lastCommittedSearchRef.current = nextSearchTerm;
    setLocalSearchTerm(nextSearchTerm);
    onSearchChangeRef.current?.(nextSearchTerm, { source: "external" });
  }, [paramKeys, searchParams]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const normalizedSearchTerm = localSearchTerm.trim();

      if (normalizedSearchTerm === lastCommittedSearchRef.current) {
        if (localSearchTerm !== normalizedSearchTerm) {
          setLocalSearchTerm(normalizedSearchTerm);
        }
        return;
      }

      lastCommittedSearchRef.current = normalizedSearchTerm;
      setSearchParams((current) => {
        const next = new URLSearchParams(current);

        if (normalizedSearchTerm) {
          next.set(paramKey, normalizedSearchTerm);
        } else {
          next.delete(paramKey);
        }

        for (const key of clearParamKeys) {
          if (key !== paramKey) {
            next.delete(key);
          }
        }

        return next;
      });
      onSearchChangeRef.current?.(normalizedSearchTerm, { source: "debounce" });
    }, debounceMs);

    return () => window.clearTimeout(timeoutId);
  }, [clearParamKeys, debounceMs, localSearchTerm, paramKey, setSearchParams]);

  const commitSearch = (nextSearchTerm: string, source: StandardSearchChangeMeta["source"]) => {
    const normalizedSearchTerm = nextSearchTerm.trim();

    if (localSearchTermRef.current !== normalizedSearchTerm) {
      setLocalSearchTerm(normalizedSearchTerm);
    }

    lastCommittedSearchRef.current = normalizedSearchTerm;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);

      if (normalizedSearchTerm) {
        next.set(paramKey, normalizedSearchTerm);
      } else {
        next.delete(paramKey);
      }

      for (const key of clearParamKeys) {
        if (key !== paramKey) {
          next.delete(key);
        }
      }

      return next;
    });
    onSearchChangeRef.current?.(normalizedSearchTerm, { source });
  };

  useImperativeHandle(
    ref,
    () => ({
      clear: () => {
        if (!localSearchTermRef.current && !lastCommittedSearchRef.current) {
          return;
        }
        commitSearch("", "clear");
      },
      submit: () => {
        commitSearch(localSearchTermRef.current, "submit");
      },
    }),
    [clearParamKeys, paramKey, setSearchParams],
  );

  return (
    <label
      className={`relative flex min-h-12 items-center rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition focus-within:border-red-200 focus-within:shadow-[0_0_0_4px_rgba(254,226,226,0.85)] ${className}`.trim()}
    >
      <Search className="pointer-events-none h-4 w-4 shrink-0 text-slate-400" />
      <input
        aria-label={placeholder}
        className={`w-full bg-transparent pl-2 pr-8 text-sm text-slate-800 outline-none placeholder:text-slate-400 ${inputClassName}`.trim()}
        onChange={(event) => setLocalSearchTerm(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commitSearch(localSearchTermRef.current, "submit");
          }
        }}
        placeholder={placeholder}
        type="search"
        value={localSearchTerm}
      />
      {localSearchTerm.length > 0 ? (
        <button
          aria-label="清空搜索"
          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 transition hover:text-slate-500"
          onClick={() => commitSearch("", "clear")}
          type="button"
        >
          <XCircle className="h-4 w-4" />
        </button>
      ) : null}
    </label>
  );
});
