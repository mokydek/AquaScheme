import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SOURCE_ROOT = dirname(fileURLToPath(import.meta.url))
const CONTROL_TAGS = new Set(['input', 'select', 'textarea'])

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return extname(entry.name) === '.tsx' ? [path] : []
  })
}

function attributeValue(node: ts.JsxAttributes, name: string, source: ts.SourceFile): string | null {
  const attribute = node.properties.find(
    (candidate): candidate is ts.JsxAttribute => ts.isJsxAttribute(candidate) && candidate.name.getText() === name,
  )
  const initializer = attribute?.initializer
  if (!initializer) return null
  if (ts.isStringLiteral(initializer)) return `static:${initializer.text}`
  if (ts.isJsxExpression(initializer) && initializer.expression) {
    if (ts.isStringLiteral(initializer.expression) || ts.isNoSubstitutionTemplateLiteral(initializer.expression)) {
      return `static:${initializer.expression.text}`
    }
  }
  return initializer.getText(source)
}

function hasNonEmptyAttribute(node: ts.JsxAttributes, name: string): boolean {
  const attribute = node.properties.find(
    (candidate): candidate is ts.JsxAttribute => ts.isJsxAttribute(candidate) && candidate.name.getText() === name,
  )
  const initializer = attribute?.initializer
  if (!initializer) return false
  if (ts.isStringLiteral(initializer)) return initializer.text.trim().length > 0
  if (!ts.isJsxExpression(initializer) || !initializer.expression) return true
  const expression = initializer.expression
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text.trim().length > 0
  }
  if (expression.kind === ts.SyntaxKind.NullKeyword || expression.kind === ts.SyntaxKind.FalseKeyword) return false
  return !(ts.isIdentifier(expression) && expression.text === 'undefined')
}

function tagName(node: ts.JsxOpeningLikeElement, source: ts.SourceFile): string {
  return node.tagName.getText(source)
}

function nestedFormControls(node: ts.Node, source: ts.SourceFile): ts.JsxOpeningLikeElement[] {
  const controls: ts.JsxOpeningLikeElement[] = []
  const visit = (child: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child))
      && CONTROL_TAGS.has(tagName(child, source))
    ) {
      controls.push(child)
      return
    }
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  return controls
}

function labelHasMeaningfulContent(node: ts.JsxElement, source: ts.SourceFile): boolean {
  let found = false
  const visit = (child: ts.Node) => {
    if (found) return
    if (
      (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child))
      && CONTROL_TAGS.has(tagName(child, source))
    ) return
    if (ts.isJsxText(child) && child.text.trim().length > 0) {
      found = true
      return
    }
    if (ts.isJsxExpression(child) && child.expression) {
      found = true
      return
    }
    ts.forEachChild(child, visit)
  }
  node.children.forEach(visit)
  return found
}

function isLabeledByAncestor(node: ts.JsxOpeningLikeElement, source: ts.SourceFile): boolean {
  const controlId = attributeValue(node.attributes, 'id', source)
  let current = node.parent
  while (current) {
    if (ts.isJsxElement(current) && current.openingElement.tagName.getText(source) === 'label') {
      const target = attributeValue(current.openingElement.attributes, 'htmlFor', source)
      if (target !== null) return controlId !== null && target === controlId
      return nestedFormControls(current, source).length === 1 && labelHasMeaningfulContent(current, source)
    }
    current = current.parent
  }
  return false
}

describe('direct JSX form markup contract', () => {
  it('gives every form control explicit non-empty id/name and a source-visible accessible name', () => {
    const violations: string[] = []
    const staticControlIds = new Map<string, string>()

    for (const file of sourceFiles(SOURCE_ROOT)) {
      const text = readFileSync(file, 'utf8')
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const controls: ts.JsxOpeningLikeElement[] = []
      const labels: ts.JsxElement[] = []
      const location = (node: ts.Node) => {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
        return `${relative(SOURCE_ROOT, file).replaceAll('\\', '/')}:${line + 1}`
      }

      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = tagName(node, source)
          if (CONTROL_TAGS.has(tag)) controls.push(node)
        }

        if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'label') labels.push(node)

        ts.forEachChild(node, visit)
      }

      visit(source)

      const controlIds = new Set(
        controls
          .map((control) => attributeValue(control.attributes, 'id', source))
          .filter((value): value is string => value !== null),
      )
      const labelTargets = new Set(
        labels
          .map((label) => attributeValue(label.openingElement.attributes, 'htmlFor', source))
          .filter((value): value is string => value !== null),
      )

      for (const control of controls) {
        const tag = tagName(control, source)
        const missing = ['id', 'name'].filter((attribute) => !hasNonEmptyAttribute(control.attributes, attribute))
        if (missing.length > 0) {
          violations.push(`${location(control)} <${tag}> missing or empty ${missing.join(' and ')}`)
        }

        const id = attributeValue(control.attributes, 'id', source)
        if (id?.startsWith('static:')) {
          const previous = staticControlIds.get(id)
          if (previous) violations.push(`${location(control)} <${tag}> duplicates control id used at ${previous}`)
          else staticControlIds.set(id, location(control))
        }

        const hasAccessibleName = isLabeledByAncestor(control, source)
          || hasNonEmptyAttribute(control.attributes, 'aria-label')
          || hasNonEmptyAttribute(control.attributes, 'aria-labelledby')
          || (id !== null && labelTargets.has(id))
        if (!hasAccessibleName) {
          violations.push(`${location(control)} <${tag}> missing an associated label or aria-label`)
        }
      }

      for (const label of labels) {
        const target = attributeValue(label.openingElement.attributes, 'htmlFor', source)
        const nestedControls = nestedFormControls(label, source)
        if (target !== null && !controlIds.has(target)) {
          violations.push(`${location(label)} <label> has htmlFor without a matching control id`)
        } else if (target === null && nestedControls.length !== 1) {
          violations.push(`${location(label)} <label> must contain exactly one form control or use htmlFor`)
        }
        if (!labelHasMeaningfulContent(label, source)) {
          violations.push(`${location(label)} <label> has no source-visible text or expression`)
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([])
  })
})
