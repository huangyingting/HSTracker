"use client";

import { useEffect, useId, useRef, useState } from "react";

import type {
  ProductSearchLocale,
  ProductSearchProduct,
  ProductSearchResult,
} from "../catalog/product-catalog";
import {
  parseTradeAnalysisContext,
  productCodeOf,
  serializeTradeAnalysisContext,
  withProductCode,
} from "./trade-analysis-context";

const copy = {
  en: {
    eyebrow: "Choose a product",
    title: "Start with an HS 2012 product.",
    label: "HS 2012 product",
    help:
      "Search HS 2012 code or English/Chinese product words. Confirmation covers HS12 categories; it does not classify SKUs or convert HS17/HS22.",
    placeholder: "Code or product words",
    loading: "Searching products…",
    tooShort: "Enter at least two characters to search.",
    noMatch:
      "No HS 2012 product matched. Check the revision or try product words.",
    unsupported:
      "That HS revision is not supported. This workspace uses HS 2012.",
    failed: "Product search is temporarily unavailable.",
    retired: "This product catalog has retired. Refresh the current analysis.",
    refresh: "Refresh current analysis",
    selected: "Selected product",
    change: "Change product",
    match: "Matched",
  },
  "zh-Hans": {
    eyebrow: "选择产品",
    title: "从一个 HS 2012 产品开始。",
    label: "HS 2012 产品",
    help:
      "搜索 HS 2012 编码或中英文产品词语。确认仅涵盖 HS12 类别；不进行 SKU 归类或 HS17/HS22 转换。",
    placeholder: "编码或产品词语",
    loading: "正在搜索产品…",
    tooShort: "请输入至少两个字符进行搜索。",
    noMatch: "未找到匹配的 HS 2012 产品。请检查版本或尝试产品词语。",
    unsupported: "不支持该 HS 版本。本工作区使用 HS 2012。",
    failed: "产品搜索暂时不可用。",
    retired: "该产品目录已停用。请刷新当前分析。",
    refresh: "刷新当前分析",
    selected: "已选择产品",
    change: "更改产品",
    match: "匹配内容",
  },
} as const;

type ProductComboboxProps = {
  productSearchBuildId: string;
  locale: ProductSearchLocale;
  onSelectionChange: (
    product: ProductSearchProduct | null,
    source: "restore" | "explicit",
  ) => void;
  onRetiredBuild: () => void;
  onMountFocus?: () => void;
  syncUrl?: boolean;
};

type SearchMatch = ProductSearchResult["matches"][number];

export function ProductCombobox({
  productSearchBuildId,
  locale,
  onSelectionChange,
  onRetiredBuild,
  onMountFocus,
  syncUrl = true,
}: ProductComboboxProps) {
  const messages = copy[locale];
  const instanceId = useId();
  const titleId = `${instanceId}-title`;
  const inputId = `${instanceId}-search`;
  const helpId = `${instanceId}-help`;
  const statusId = `${instanceId}-status`;
  const listboxId = `${instanceId}-options`;
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSequence = useRef(0);
  const explicitlyEdited = useRef(false);
  const initialLocale = useRef(locale);
  const [inputValue, setInputValue] = useState("");
  const [searchLocale, setSearchLocale] = useState<ProductSearchLocale>(locale);
  const [matches, setMatches] = useState<readonly SearchMatch[]>([]);
  const [selectedProduct, setSelectedProduct] =
    useState<ProductSearchProduct | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<
    | "idle"
    | "loading"
    | "too-short"
    | "no-match"
    | "unsupported"
    | "retired"
    | "failed"
  >("idle");

  useEffect(() => {
    if (onMountFocus === undefined) {
      return;
    }
    inputRef.current?.focus();
    onMountFocus();
  }, [onMountFocus]);

  useEffect(() => {
    const productCode = productCodeOf(
      parseTradeAnalysisContext(window.location.href),
    );
    if (productCode === null) {
      return;
    }

    const controller = new AbortController();
    void (async () => {
      try {
        const parameters = new URLSearchParams({
          q: productCode,
          locale: initialLocale.current,
          limit: "20",
        });
        const response = await fetch(
          productSearchUrl(productSearchBuildId, parameters),
          { signal: controller.signal },
        );
        if (!response.ok) {
          throw new ProductSearchResponseError(response.status);
        }
        const result = (await response.json()) as ProductSearchResult;
        const restoredProduct = result.matches.find(
          ({ product, match }) =>
            product.code === productCode && match.class === "EXACT_CODE",
        )?.product;
        if (!explicitlyEdited.current && restoredProduct !== undefined) {
          setSelectedProduct(restoredProduct);
          setStatus("idle");
          onSelectionChange(restoredProduct, "restore");
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        const nextStatus = productSearchErrorStatus(error);
        if (nextStatus === "failed") {
          console.error("Canonical product restoration failed", error);
        }
        if (!explicitlyEdited.current) {
          setStatus(nextStatus);
        }
      }
    })();

    return () => controller.abort();
  }, [onSelectionChange, productSearchBuildId]);

  useEffect(() => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    if (selectedProduct !== null) {
      return;
    }

    const normalized = inputValue.normalize("NFKC").trim();
    // The catalog decides whether a short query is an exact reviewed alias.
    if (normalized.length === 0) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const parameters = new URLSearchParams({
          q: inputValue,
          locale: searchLocale,
          limit: "20",
        });
        const response = await fetch(
          productSearchUrl(productSearchBuildId, parameters),
          { signal: controller.signal },
        );
        if (!response.ok) {
          throw new ProductSearchResponseError(response.status);
        }
        const result = (await response.json()) as ProductSearchResult;
        if (requestSequence.current !== sequence) {
          return;
        }

        setActiveIndex(-1);
        if (result.state === "RESULTS") {
          setMatches(result.matches);
          setOpen(result.matches.length > 0);
          setStatus("idle");
        } else {
          setMatches([]);
          setOpen(false);
          setStatus(
            result.state === "UNSUPPORTED_HS_REVISION"
              ? "unsupported"
              : result.state === "SUPPRESSED_SHORT_QUERY"
                ? "too-short"
                : "no-match",
          );
        }
      } catch (error) {
        if (controller.signal.aborted || requestSequence.current !== sequence) {
          return;
        }
        const nextStatus = productSearchErrorStatus(error);
        if (nextStatus === "failed") {
          console.error("Product search request failed", error);
        }
        setMatches([]);
        setOpen(false);
        setStatus(nextStatus);
      }
    }, 150);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [inputValue, productSearchBuildId, searchLocale, selectedProduct]);

  function selectProduct(product: ProductSearchProduct) {
    explicitlyEdited.current = true;
    setSelectedProduct(product);
    setMatches([]);
    setActiveIndex(-1);
    setOpen(false);
    setStatus("idle");
    onSelectionChange(product, "explicit");

    if (syncUrl) {
      const context = withProductCode(
        parseTradeAnalysisContext(window.location.href),
        product.code,
      );
      const url = serializeTradeAnalysisContext(window.location.href, context);
      window.history.replaceState(null, "", url);
    }
  }

  function clearSelectedIdentity() {
    if (selectedProduct === null) {
      return;
    }
    setSelectedProduct(null);
    onSelectionChange(null, "explicit");
    if (syncUrl) {
      const context = withProductCode(
        parseTradeAnalysisContext(window.location.href),
        null,
      );
      const url = serializeTradeAnalysisContext(window.location.href, context);
      window.history.replaceState(null, "", url);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
      return;
    }
    if (matches.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        current <= 0 ? matches.length - 1 : current - 1,
      );
    } else if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      selectProduct(matches[activeIndex].product);
    }
  }

  return (
    <section className="product-discovery" aria-labelledby={titleId}>
      <p className="product-eyebrow">{messages.eyebrow}</p>
      <h2 id={titleId}>{messages.title}</h2>
      <div className="product-field">
        <label htmlFor={inputId}>{messages.label}</label>
        <div className="product-input-frame">
          <span aria-hidden="true">HS12</span>
          <input
            ref={inputRef}
            id={inputId}
            type="search"
            role="combobox"
            autoComplete="off"
            spellCheck="false"
            value={
              selectedProduct === null
                ? inputValue
                : productLabel(selectedProduct, locale)
            }
            placeholder={messages.placeholder}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={open}
            aria-activedescendant={
              open && activeIndex >= 0
                ? optionId(listboxId, matches[activeIndex].product.code)
                : undefined
            }
            aria-describedby={`${helpId} ${statusId}`}
            onChange={(event) => {
              explicitlyEdited.current = true;
              const nextValue = event.target.value;
              clearSelectedIdentity();
              setInputValue(nextValue);
              setSearchLocale(locale);
              setMatches([]);
              setActiveIndex(-1);
              setOpen(false);
              setStatus("idle");
            }}
            onFocus={() => {
              if (matches.length > 0) {
                setOpen(true);
              }
            }}
            onBlur={() => {
              setOpen(false);
              setActiveIndex(-1);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
        <p id={helpId} className="product-help">
          {messages.help}
        </p>
        {selectedProduct === null ? null : (
          <div className="product-selection" aria-label={messages.selected}>
            <strong>HS 2012 · {selectedProduct.code}</strong>
            <span>{productDescription(selectedProduct, locale)}</span>
            <small>{adjacentProductDescription(selectedProduct, locale)}</small>
            <button
              type="button"
              className="product-change-action"
              onClick={() => {
                clearSelectedIdentity();
                setInputValue("");
                inputRef.current?.focus();
              }}
            >
              {messages.change}
            </button>
          </div>
        )}
        {open ? (
          <ul
            id={listboxId}
            className="product-options"
            role="listbox"
            aria-label={messages.label}
          >
            {matches.map(({ product, match }, index) => (
              <li
                id={optionId(listboxId, product.code)}
                key={product.code}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectProduct(product)}
              >
                <strong>HS 2012 · {product.code}</strong>
                <span className="product-primary-description">
                  {productDescription(product, locale)}
                </span>
                <span className="product-adjacent-description">
                  {adjacentProductDescription(product, locale)}
                </span>
                <small>
                  {messages.match}: {match.matchedText}
                </small>
              </li>
            ))}
          </ul>
        ) : null}
        <p
          id={statusId}
          className={`product-status product-status-${status}`}
          aria-live="polite"
        >
          {status === "loading"
            ? messages.loading
            : status === "too-short"
              ? messages.tooShort
              : status === "no-match"
                ? messages.noMatch
                : status === "unsupported"
                  ? messages.unsupported
                  : status === "retired"
                    ? messages.retired
                    : status === "failed"
                      ? messages.failed
                      : selectedProduct === null
                        ? ""
                        : `${messages.selected}: HS 2012 · ${selectedProduct.code}`}
        </p>
        {status === "retired" ? (
          <button
            className="economy-refresh-button"
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onRetiredBuild}
          >
            {messages.refresh}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function productDescription(
  product: ProductSearchProduct,
  locale: ProductSearchLocale,
): string {
  return locale === "en"
    ? product.sourceDescriptionEn
    : product.auxiliaryDescriptionZhHans;
}

function productLabel(
  product: ProductSearchProduct,
  locale: ProductSearchLocale,
): string {
  return `HS 2012 · ${product.code} — ${productDescription(product, locale)}`;
}

function adjacentProductDescription(
  product: ProductSearchProduct,
  locale: ProductSearchLocale,
): string {
  return locale === "en"
    ? product.auxiliaryDescriptionZhHans
    : product.sourceDescriptionEn;
}

function optionId(listboxId: string, productCode: string): string {
  return `${listboxId}-option-${productCode}`;
}

function productSearchUrl(
  productSearchBuildId: string,
  parameters: URLSearchParams,
): string {
  return `/api/v1/product-catalogs/${productSearchBuildId}/products?${parameters}`;
}

class ProductSearchResponseError extends Error {
  constructor(readonly status: number) {
    super(`Product search returned ${status}.`);
    this.name = "ProductSearchResponseError";
  }
}

function productSearchErrorStatus(error: unknown): "retired" | "failed" {
  return error instanceof ProductSearchResponseError && error.status === 410
    ? "retired"
    : "failed";
}
