;(function($) {
    'use strict';
    var undefined;
    var slice = Array.prototype.slice;
    var isFunction = $.isFunction;
    var isString = function(obj) {
        return typeof obj == 'string';
    };
    var returnFalse = function() {
        return false;
    };

    function calculateAngle(x1, x2, y1, y2) {
        var x = x1 - x2;
        var y = y1 - y2;
        var r = Math.atan2(y, x);
        var angle = Math.round(r * 180 / Math.PI);
        if (angle < 0) {
            angle = 360 - Math.abs(angle);
        }
        return angle;
    }

    function calculateDirection(x1, x2, y1, y2) {
        var angle = calculateAngle(x1, x2, y1, y2);
        if ((angle <= 45 && angle >= 0) || (angle <= 360 && angle >= 315)) {
            return 'left';
        } else if (angle >= 135 && angle <= 225) {
            return 'right';
        } else if (angle > 45 && angle < 135) {
            return 'down';
        } else {
            return 'up';
        }
    }

    var PLUGIN_NS = '_TOUCH_';
    var SUPPORTS_TOUCH = 'ontouchstart' in window;
    var SUPPORTS_POINTER_IE10 = window.navigator.msPointerEnabled && !window.navigator.pointerEnabled;
    var SUPPORTS_POINTER = window.navigator.pointerEnabled || window.navigator.msPointerEnabled;
    var useTouchEvents = SUPPORTS_TOUCH || SUPPORTS_POINTER;
    var START_EV = useTouchEvents ? (SUPPORTS_POINTER ? (SUPPORTS_POINTER_IE10 ? 'MSPointerDown' : 'pointerdown') : 'touchstart') : 'mousedown';
    var MOVE_EV = useTouchEvents ? (SUPPORTS_POINTER ? (SUPPORTS_POINTER_IE10 ? 'MSPointerMove' : 'pointermove') : 'touchmove') : 'mousemove';
    var END_EV = useTouchEvents ? (SUPPORTS_POINTER ? (SUPPORTS_POINTER_IE10 ? 'MSPointerUp' : 'pointerup') : 'touchend') : 'mouseup';
    var CANCEL_EV = (SUPPORTS_POINTER ? (SUPPORTS_POINTER_IE10 ? 'MSPointerCancel' : 'pointercancel') : 'touchcancel');

    var defaults = {
        fingers: 1,
        threshold: 75,
        fingerReleaseThreshold: 250,
        longTapThreshold: 500,
        doubleTapThreshold: 200,
        fallbackToMouseEvents: true,
        excludedElements: 'label, button, input, select, textarea, .noTouch',
        preventDefaultEvents: true,
        swipeMove: null
    };

    // 这个入口用来设置参数的
    $.fn.touch = function(options) {
        if (typeof options === 'object') {
            this.data(PLUGIN_NS, $.extend({}, $.fn.touch.defaults, options));
        }
    };

    $.fn.touch.defaults = defaults;

    var singleTapTimeout = null;
    var holdTimeout = null;

    var _tid = 1;
    var handlers = {};

    function isTouchEvent(event) {
        return /^(tap|doubleTap|longTap|swipe|swipeLeft|swipeRight|swipeUp|swipeDown)$/.test(parse(event).e);
    }

    function tid(element) {
        return element._tid || (element._tid = _tid++);
    }

    function parse(event) {
        var parts = ('' + event).split('.')
        return {
            e: parts[0],
            ns: parts.slice(1).sort().join(' ')
        }
    }

    function matcherFor(ns) {
        return new RegExp('(?:^| )' + ns.replace(' ', ' .* ?') + '(?: |$)');
    }

    function findHandlers(element, event, fn, selector) {
        event = parse(event);
        if (event.ns) {
            var matcher = matcherFor(event.ns);
        }
        return (handlers[tid(element)] || []).filter(function(handler) {
            return handler && (!event.e || handler.e == event.e) && (!event.ns || matcher.test(handler.ns)) && (!fn || tid(handler.fn) === tid(fn)) && (!selector || handler.sel == selector);
        });
    }

    function removeTouch(element, event, selector, callback) {
        if (!isString(selector) && !isFunction(callback) && callback !== false) {
            callback = selector;
            selector = undefined;
        }
        if (callback === false) {
            callback = returnFalse;
        }
        var id = tid(element);
        var offHandlers = findHandlers(element, event, callback, selector);
        $.each(offHandlers, function(index, handler) {
            handlers[id].splice(handler.i, 1);
        });
    }

    function Touch(element, event, selector, data, callback) {
        if (!isString(selector) && !isFunction(callback) && callback !== false) {
            callback = data;
            data = selector;
            selector = undefined;
        }
        if (callback === undefined || data === false) {
            callback = data;
            data = undefined;
        }
        if (callback === false) {
            callback = returnFalse;
        }

        var handler = parse(event);
        handler.fn = callback;
        handler.callback = callback;

        if (selector) {
            handler.callback = function(e) {
                var match = $(e.target).closest(selector, element).get(0);
                if (match && match !== element) {
                    return callback.apply(match, arguments);
                }
            };
            handler.sel = selector;
        }

        // 判断是否已经添加过touch
        var hasTouch = !!element._tid;

        var id = tid(element);
        var set = (handlers[id] || (handlers[id] = []));
        handler.i = set.length;
        set.push(handler);

        if (typeof Touch.instance === 'object' && hasTouch) {
            return Touch.instance;
        }

        this.handler = set;
        this.el = element;
        this.$el = $(element);
        this.options = this.$el.data(PLUGIN_NS) || $.fn.touch.defaults;
        this.$el.on(START_EV, $.proxy(this.touchStart, this)).on(CANCEL_EV, $.proxy(this.touchCancel, this));

        Touch.instance = this;
    }

    Touch.prototype = {
        _isTouch: false,
        _doubleTapTime: 0,
        touch: {},
        touchStart: function(e) {
            var _this = this;
            var options = this.options;
            if (this._isTouch || $(e.target).closest(options.excludedElements, this.el).length) {
                return;
            }

            this._status = 'start';

            var touches = e.touches;
            var evt = touches ? touches[0] : e;
            var fingerCount = 0;

            if (touches) {
                fingerCount = touches.length;
            } else if (options.preventDefaultEvents) {
                e.preventDefault();
            }

            this.createTouchData(evt);

            if (!touches || (fingerCount === options.fingers || options.fingers === 'all')) {
                if (this.hasEvent('longTap')) {
                    holdTimeout = setTimeout(function() {
                        _this.trigger('longTap', e);
                    }, options.longTapThreshold);
                }
                this.setTouchProgress(true);
            } else {
                this._status = 'cancel';
                this.triggerHandler(e);
                return false;
            }
        },
        touchMove: function(e) {
            if (this._status === 'end' || this._status === 'cancel') {
                return;
            }
            if (this.hasEvent('longTap')) {
                holdTimeout && clearTimeout(holdTimeout);
                return;
            }
            var touches = e.touches;
            var evt = touches ? touches[0] : e;
            this.updateTouchData(evt);
            this.touch.now = e.timeStamp;
            if (this.hasSwipe()) {
                this._status = 'move';
                if (this.options.preventDefaultEvents) {
                    e.preventDefault();
                }
                if (isFunction(this.options.swipeMove)) {
                    var direction = this.getDirection();
                    var distance = (direction === 'up' || direction === 'down') ? this.touch.y2 - this.touch.y1 : this.touch.x2 - this.touch.x1;
                    var duration = this.getDuration();
                    this.$el.trigger('swipeMove', [direction, distance, duration, e]);
                    this.options.swipeMove.call(this.el, e, direction, distance, duration);
                }
            } else {
                this._status = 'cancel';
                this.triggerHandler(e);
            }
        },
        touchEnd: function(e) {

            this.touch.now = e.timeStamp;
            this._status = this._status === 'move' ? 'end' : 'cancel';

            this.triggerHandler(e);

            this.touchCancel();
        },
        touchCancel: function() {
            this.touch = {};
            this.setTouchProgress(false);
        },
        triggerHandler: function(e) {
            var _this = this;
            if (this._status === 'end' && this.isSwipe() && this.hasSwipe()) {
                var swipes = this.getSwipe();
                var direction = this.getDirection();
                $.each(swipes, function(index, event) {
                    _this.trigger(event, e, direction);
                });
            } else if (this._status === 'cancel' || this._status === 'end') {
                holdTimeout && clearTimeout(holdTimeout);
                singleTapTimeout && clearTimeout(singleTapTimeout);
                holdTimeout = singleTapTimeout = null;

                if (this.isDoubleTap()) {
                    this._doubleTapTime = null;
                    this.trigger('doubleTap', e);
                } else if (this.isLongTap()) {
                    this._doubleTapTime = null;
                    this.trigger('longTap', e);
                } else if (this.isTap()) {
                    if (this.hasEvent('doubleTap') && !this.isDoubleTap()) {
                        this._doubleTapTime = this.touch.now;
                        singleTapTimeout = setTimeout(function() {
                            _this._doubleTapTime = null;
                        }, this.options.doubleTapThreshold);
                    } else {
                        this._doubleTapTime = null;
                    }
                    if (this.hasEvent('tap')) {
                        this.trigger('tap', e);
                    }
                }
                this.touchCancel();
            }
        },
        trigger: function(event, evt) {
            var _this = this;
            var args = slice.call(arguments, 1);
            // this.$el.trigger(event, evt);
            $.each(this.handler, function(index, handler) {
                if (handler.e === event) {
                    handler.callback.apply(_this.el, args);
                }
            });
        },
        hasEvent: function(event) {
            var handler = this.handler;
            var ret = false;
            var reg = new RegExp('^(' + event + ')$');
            for (var i = handler.length - 1; i >= 0; i--) {
                if (reg.test(handler[i].e)) {
                    ret = true;
                    break;
                }
            }
            return ret;
        },
        hasSwipe: function() {
            return this.hasEvent('swipe|swipeLeft|swipeRight|swipeUp|swipeDown');
        },
        getSwipe: function() {
            var result = [];
            var handler = this.handler;
            var swipes = {
                swipe: 1,
                swipeLeft: 1,
                swipeRight: 1,
                swipeUp: 1,
                swipeDown: 1
            };
            for (var i = handler.length - 1; i >= 0; i--) {
                if (swipes[handler[i].e]) {
                    swipes[handler[i].e] = 0;
                }
            }
            $.each(swipes, function(key, value) {
                value === 0 && result.push(key);
            });
            return result;
        },
        isSwipe: function() {
            return this.getDistance() >= this.options.threshold && this.touch.x2;
        },
        isDoubleTap: function() {
            if (this._doubleTapTime === null) {
                return false;
            }
            return this.hasEvent('doubleTap') && ((this.touch.now - this._doubleTapTime) <= this.options.doubleTapThreshold);
        },
        hasTap: function() {
            return this.hasEvent('tap|doubleTap');
        },
        isTap: function() {
            return this.hasTap() && this.getDistance() < this.options.threshold;
        },
        isLongTap: function() {
            return this.hasEvent('longTap') && this.getDuration() > this.options.longTapThreshold && this.getDistance() < 10;
        },
        createTouchData: function(e) {
            var touch = {};
            touch.x1 = touch.x2 = e.pageX || e.clientX;
            touch.y1 = touch.y2 = e.pageY || e.clientY;
            touch.now = touch.last = new Date().getTime();
            this.touch = touch;
            return touch;
        },
        updateTouchData: function(e) {
            this.touch.x2 = e.pageX || e.clientX;
            this.touch.y2 = e.pageY || e.clientY;
        },
        getDirection: function() {
            var touch = this.touch;
            return calculateDirection(touch.x1, touch.x2, touch.y1, touch.y2);
        },
        getDistance: function() {
            var touch = this.touch;
            return Math.round(Math.sqrt(Math.pow(touch.x2 - touch.x1, 2) + Math.pow(touch.y2 - touch.y1, 2)));
        },
        getDuration: function() {
            var touch = this.touch;
            return touch.now - touch.last;
        },
        setTouchProgress: function(isTouch) {
            if (isTouch) {
                this.$el.on(MOVE_EV, $.proxy(this.touchMove, this)).on(END_EV, $.proxy(this.touchEnd, this));
            } else {
                this.$el.off(MOVE_EV, $.proxy(this.touchMove, this)).off(END_EV, $.proxy(this.touchEnd, this));
            }
            this._isTouch = isTouch;
        }
    };

    var _on = $.fn.on;
    var _off = $.fn.off;

    $.fn.on = function(event, selector, data, callback) {
        if (event && !isString(event)) {
            return _on.apply(this, arguments);
        }

        if (isTouchEvent(event)) {
            this.each(function() {
                new Touch(this, event, selector, data, callback);
            });
            return this;
        } else {
            return _on.apply(this, arguments);
        }
    };

    $.fn.off = function(event, selector, callback) {
        if (event && !isString(event)) {
            return _off.apply(this, arguments);
        }

        if (isTouchEvent(event)) {
            this.each(function() {
                removeTouch(this, event, selector, callback);
            });
            return this;
        } else {
            return _off.apply(this, arguments);
        }
    };

})(window.Zepto || window.jQuery);
