/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { isString } from 'utils/core-utils';
import { randomString } from 'utils/string-utils';

function _getOptionTooltip(tooltip) {
    if (!tooltip) {
        return '';
    }

    if (isString(tooltip)) {
        return {
            text: tooltip,
            position: 'after'
        };
    }

    if (!tooltip.position) {
        return {
            ...tooltip,
            position: 'after'
        };
    }

    return tooltip;
}

export default class OptionRowViewModel {
    focusId = randomString();
    focusHandler = null;
    value = ko.observable();
    label = ko.observable();
    remark = ko.observable();
    icon = ko.observable();
    tooltip = ko.observable();
    css = ko.observable();
    disabled = ko.observable();
    selected = ko.observable();
    tabIndex = ko.observable();
    hasFocus = ko.observable();

    constructor({ onFocus }) {
        this.focusHandler = onFocus;
    }

    onUpdate(option, multiselect, selectedValues, focus) {
        const {
            value,
            label,
            remark,
            icon,
            selectedIcon,
            css,
            disabled
        } = option;

        const isSelected = selectedValues.includes(value);

        this.value(value);
        this.label(label.toString());
        this.remark(remark);
        this.icon(isSelected ? selectedIcon : icon);
        this.tooltip(_getOptionTooltip(option.tooltip));
        this.css(css);
        this.disabled(disabled);
        this.selected(isSelected);
        this.tabIndex(disabled ? false : '0');
        this.hasFocus(focus === this.focusId);
    }

    onFocus(val) {
        this.focusHandler(val ? this.focusId : '');
    }

    onMouseDown() {
        // Prevent disabled options form foucsing out
        // the active element.
        return !this.disabled();
    }
}

