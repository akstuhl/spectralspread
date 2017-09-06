import Vue from 'vue';
import template from './spreader.html';
import * as d3 from 'd3';
import Tone from 'tone';

import './spreader.scss';

export default Vue.extend({
  template,

  data() {
    return {
      numChannels: 8,
      userMediaChannel: 'default',
      userMediaOptions: [],
      userMediaPlaying: false,
      userMediaGain: 1.0,
      filePlaying: false,
      fileLoop: false,
      fileVolume: 1.0,
      baseDelayTime: 2.0,
      minDelayTime: 0.01,
      maxDelayTime: 15.0,
      feedbackLevel: 0.75,
      dryLevel: 1.0,
      minFreq: 20,
      maxFreqExp: 2.306,
      graphW: 600,
      graphH: 400,
      graphPad: 50
    };
  },

  mounted() {
    var START_DELAY = 1.0;

    this.selected = this.dragged = null;

    this.analyser = Tone.context.createAnalyser();
    this.analyser.connect(Tone.context.destination);
    this.mainOut = new Tone.Gain(1.0).connect(this.analyser);
    this.input = new Tone.UserMedia();
    this.tom = new Tone.PluckSynth();
    this.channels = [];
    this.freqs = [];
    this.dry = new Tone.Gain(this.dryLevel).connect(this.mainOut);
    this.mainIn = new Tone.Gain(1.0).connect(this.dry);
    this.tom.connect(this.mainIn);
    this.fileGain = new Tone.Gain(this.fileVolume).connect(this.mainIn);

    this.input.enumerateDevices().then(function(devices) {
      this.userMediaOptions = devices;
    }.bind(this));

    for (var i = 0; i < this.numChannels; i++) {
      var channel = {};
      channel.delay = Tone.context.createDelay(this.maxDelayTime);
      channel.gain = Tone.context.createGain();
      channel.delay.delayTime.value = START_DELAY;
      channel.gain.gain.value = this.feedbackLevel;
      channel.delay.connect(channel.gain);
      channel.gain.connect(channel.delay);
      channel.gain.connect(this.mainOut);
      var filterType = 'bandpass';
      if (i === 0) {
        filterType = 'lowpass';
      } else if (i === this.numChannels - 1) {
        filterType = 'highpass';
      }
      var freq = Math.pow(this.minFreq, 1 + ((i + 1) / (this.numChannels + 1)) * this.maxFreqExp);
      this.freqs.push(freq);
      channel.filter = new Tone.Filter(freq, filterType).connect(channel.delay);
      this.mainIn.connect(channel.filter);
      this.channels.push(channel);
    }

    this.freqScale = new d3.scaleLog()
      .domain([20, 20000])
      .range([0, this.graphW]);

    this.timeScale = new d3.scaleLinear()
      .domain([this.minDelayTime, this.baseDelayTime])
      .range([this.graphH, 0]);

    this.freqLinePoints = [[0, this.timeScale(START_DELAY)], [this.graphW, this.timeScale(START_DELAY)]];

    this.freqLine = d3.line();

    this.editorGraph = d3.select('#editor')
      .append('svg')
        .attr('width', this.graphW + this.graphPad * 2.0)
        .attr('height', this.graphH + this.graphPad * 2.0)
      .append('g')
        .attr('transform', 'translate(' + this.graphPad + ',' + this.graphPad + ')');

    this.editorGraph.append('rect')
      .attr('width', this.graphW)
      .attr('height', this.graphH)
      .attr('fill', 'transparent')
      .attr('stroke', 'black')
      .on('mousedown', this.freqGraphMousedown);

    d3.select(window)
      .on('mousemove', this.freqGraphMousemove)
      .on('mouseup', this.freqGraphMouseup)
      .on('keydown', this.keydown);

    this.freqAxis = d3.axisBottom(this.freqScale)
      .ticks(8, ',.0f');

    this.editorGraph.append('g')
      .attr('transform', 'translate(0,' + this.graphH + ')')
      .call(this.freqAxis);

    this.timeAxis = d3.axisRight(this.timeScale)
      .ticks(8, 'r')
      .tickSize(-this.graphW);

    this.editorGraph.append('g')
      .attr('transform', 'translate(' + this.graphW + ',0)')
      .attr('class', 'timeAxis')
      .call(this.timeAxis);

    this.editorGraph.append('path')
      .attr('class', 'freqLinePath')
      .attr('stroke', 'black')
      .attr('fill', 'transparent')
      .datum(this.freqLinePoints);

    this.drawFreqLineGraph();

    this.canvasCtx = document.getElementById('visCanvas').getContext('2d');
    this.analyser.fftSize = 256;
    this.bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(this.bufferLength);
    this.draw();
  },

  watch: {
    numChannels: function(val) {
      val = +val;
      this.channels.forEach(function(channel) {
        channel.filter.dispose();
        channel.gain.gain.value = 0.2;
        window.setTimeout(function() {
          channel.delay.disconnect();
          channel.gain.disconnect();
        }, channel.delay.delayTime.value * 1000);
      });
      this.channels = [];
      this.freqs = [];
      for (var i = 0; i < val; i++) {
        var channel = {};
        channel.delay = Tone.context.createDelay(this.maxDelayTime);
        channel.gain = Tone.context.createGain();
        channel.gain.gain.value = this.feedbackLevel;
        channel.delay.connect(channel.gain);
        channel.gain.connect(channel.delay);
        channel.gain.connect(this.mainOut);
        var filterType = 'bandpass';
        if (i === 0) {
          filterType = 'lowpass';
        } else if (i === val - 1) {
          filterType = 'highpass';
        }
        var freq = Math.pow(this.minFreq, 1.0 + ((i + 1.0) / (val + 1.0)) * this.maxFreqExp);
        this.freqs.push(freq);
        channel.filter = new Tone.Filter(freq, filterType).connect(channel.delay);
        this.mainIn.connect(channel.filter);
        this.channels.push(channel);
      }
      this.drawFreqLineGraph();
      this.updateDelayTimes();
    },
    baseDelayTime: function(val) {
      this.timeScale.domain([this.minDelayTime, val]);

      this.editorGraph.select('.timeAxis')
        .call(this.timeAxis);

      this.updateDelayTimes();
    },
    feedbackLevel: function(val) {
      this.channels.forEach(function(channel) {
        channel.gain.gain.value = val;
      });
    },
    dryLevel: function(val) {
      this.dry.gain.value = val;
    },
    filePlaying: function(val) {
      if (!this.fileObject) return;
      if (val) {
        this.bufferSource = Tone.context.createBufferSource();
        this.bufferSource.connect(this.fileGain);
        this.bufferSource.loop = this.fileLoop;
        this.fileReader = this.fileReader || new FileReader();
        this.fileReader.onload = function(ev) {
          Tone.context.decodeAudioData(ev.target.result, function(buffer) {
            this.bufferSource.buffer = buffer;
          }.bind(this));
        }.bind(this);
        this.fileReader.readAsArrayBuffer(this.fileObject);
        this.bufferSource.start();
      } else {
        this.bufferSource.stop();
        this.bufferSource.disconnect();
      }
    },
    fileLoop: function(val) {
      if (!this.bufferSource) return;
      this.bufferSource.loop = val;
    },
    fileVolume: function(val) {
      this.fileGain.gain.value = val;
    }
  },

  methods: {
    tomHit: function() {
      this.tom.triggerAttackRelease('A2', '32n');
    },
    micToggle: function() {
      if (this.input.state === 'stopped') {
        this.input.open().then(function() {
          this.input.connect(this.mainIn);
        }.bind(this));
      } else if (this.input.state === 'started') {
        this.input.close();
      }
    },
    updateDelayTimes: function() {
      this.channels.forEach(function(channel) {
        var freq = channel.filter.frequency.value;
        var freqX = this.freqScale(freq);
        var rightIndex = 1;
        while (rightIndex < this.freqLinePoints.length) {
          if (this.freqLinePoints[rightIndex][0] > freqX) {
            break;
          }
          rightIndex++;
        }
        var right = this.freqLinePoints[rightIndex],
          left = this.freqLinePoints[rightIndex - 1];
        var slope = (right[1] - left[1]) / (right[0] - left[0]);
        var timeY = freqX * slope + (left[1] - left[0] * slope);
        var time = this.timeScale.invert(timeY);
        channel.delay.delayTime.value = time;
      }.bind(this));
    },
    changeFile: function(event) {
      this.filePlaying = false;
      this.fileObject = event.target.files[0];
    },
    drawFreqLineGraph: function() {
      var freqMarkers = this.editorGraph.selectAll('.freqMarker')
        .data(this.freqs);

      freqMarkers.exit().remove();
      freqMarkers.enter().append('line')
        .attr('class', 'freqMarker')
        .attr('y1', 0)
        .attr('y2', this.graphH)
        .attr('stroke', 'green');

      this.editorGraph.selectAll('.freqMarker')
        .attr('x1', function(d) {
          return this.freqScale(d);
        }.bind(this))
        .attr('x2', function(d) {
          return this.freqScale(d);
        }.bind(this));

      var freqLineControls = this.editorGraph.selectAll('.freqLineControl')
        .data(this.freqLinePoints, function(d) { return d; });

      freqLineControls.exit().remove();
      freqLineControls.enter().append('circle')
        .attr('class', 'freqLineControl')
        .attr('r', 5)
        .on('mousedown', function(d) {
          this.selected = this.dragged = d;
          this.drawFreqLineGraph();
        }.bind(this));

      freqLineControls = this.editorGraph.selectAll('.freqLineControl')
        .classed('selected', function(d) { return d === this.selected; }.bind(this))
        .attr('cx', function(d) { return d[0]; })
        .attr('cy', function(d) { return d[1]; });

      this.editorGraph.select('.freqLinePath')
        .attr('d', this.freqLine);

      if (d3.event) {
        d3.event.preventDefault();
        d3.event.stopPropagation();
      }
    },
    freqGraphMousedown: function() {
      var m = d3.mouse(this.editorGraph.node());
      var insertAt = 1;
      while (insertAt < this.freqLinePoints.length - 1) {
        if (this.freqLinePoints[insertAt][0] > m[0]) {
          break;
        }
        insertAt++;
      }
      this.freqLinePoints.splice(insertAt, 0, m);
      this.selected = this.dragged = this.freqLinePoints[insertAt];
      this.drawFreqLineGraph();
    },
    freqGraphMousemove: function() {
      if (!this.dragged) return;
      var draggedIndex = this.freqLinePoints.indexOf(this.dragged);
      var m = d3.mouse(this.editorGraph.node());
      if (draggedIndex > 0 && draggedIndex < this.freqLinePoints.length - 1) {
        this.dragged[0] = Math.max(this.freqLinePoints[draggedIndex - 1][0] + 1.0, Math.min(this.freqLinePoints[draggedIndex + 1][0] - 1.0, m[0]));
      }
      this.dragged[1] = Math.max(0, Math.min(this.graphH, m[1]));
      this.drawFreqLineGraph();
      this.updateDelayTimes();
    },
    freqGraphMouseup: function() {
      if (!this.dragged) return;
      this.freqGraphMousemove();
      this.dragged = null;
    },
    keydown: function() {
      if (!this.selected) return;
      switch (d3.event.keyCode) {
        case 8: // backspace
        case 46: { // delete
          var i = this.freqLinePoints.indexOf(this.selected);
          if (i > 0 && i < this.freqLinePoints.length - 1) {
            this.freqLinePoints.splice(i, 1);
            this.selected = this.freqLinePoints[i - 1];
            this.drawFreqLineGraph();
          }
          break;
        }
        default:
      }
    },
    draw: function() {
      window.requestAnimationFrame(this.draw);
      this.analyser.getByteFrequencyData(this.dataArray);
      this.canvasCtx.clearRect(0, 0, this.graphW + 2.0 * this.graphPad, this.graphH + 2.0 * this.graphPad);
      var barWidth, barHeight;
      var x = this.graphPad;
      var l1 = 20,
        l2;
      for (var i = 0; i < this.bufferLength; i++) {
        l2 = l1 + (25000 - 20) / this.bufferLength;
        barWidth = this.freqScale(l2) - this.freqScale(l1) - 1.0;
        barHeight = this.dataArray[i];
        this.canvasCtx.fillStyle = 'rgb(200, 200, 200)';
        this.canvasCtx.fillRect(x, this.graphH + this.graphPad - barHeight, barWidth, barHeight);
        x += barWidth + 1;
        l1 = l2;
      }
    }
  }
});
